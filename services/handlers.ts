import { Namespace, Socket } from "socket.io";
import { gameLobby } from "../index";
import type { Info, IPlayerDetails, IRoundResult } from "../interfaces";
import { getCache, setCache, delCache } from "../cache/redis";
import { getUserIP } from "../middlewares/socketAuth";
import { updateBalanceFromAccount } from "../utilities/v2Transactions";
import { GS } from "../utilities/loadConfig";
import { BetResults } from "../models/betResults";
import { Settlements } from "../models/settlements";
import { failedBetLogger, failedSettlementLogger, logEventAndEmitResponse } from "../utilities/herlperFunc";
import { GAME_SETTINGS } from "../constants/constant";
import { createLogger } from "../utilities/logger";

const betlogger = createLogger("bets", "jsonl")
const settlementlogger = createLogger("settlements", "jsonl")

// bet format with event ->
// PB:1745227259107:A-10,B-10

export const placeBetHandler = async (io: Namespace, socket: Socket, roundId: string | number, betData: string) => {
    try {
        const info: Info = await getCache(socket.id);
        if (!info) return socket.emit("betError", "player details not found in cache");

        const gameStatus = gameLobby.getCurrentStatus();
        if (gameStatus.statusCode !== 2) return socket.emit("betError", gameStatus.statusCode < 2 ? "not accepting bets for this round" : "bets closed for this round");

        const curRndId = gameLobby.getCurrentRoundId();
        if (Number(roundId) !== curRndId.roundId) return socket.emit("betError", "invalid roundId");

        const validSymbols = ["A", "B", "+A", "+B"];
        const betsArr = betData.split(",");
        const userBet: Record<string, number> = {};
        let isInvalidPayload = 0;
        betsArr.forEach(bet => {
            let [symbol, betAmt] = bet.split("-");
            let amt = Number(betAmt);
            if (isNaN(amt) || !validSymbols.includes(symbol)) isInvalidPayload++;

            switch (symbol) {
                case "A": symbol = "PLAYER_A";
                    break;
                case "B": symbol = "PLAYER_B";
                    break;
                case "+A": symbol = "+A";
                    break;
                case "+B": symbol = "+B";
                    break;
                default:
                    isInvalidPayload++;
                    break;
            }
            console.log(isInvalidPayload, symbol, amt);
            if (userBet[symbol]) userBet[symbol] += amt;
            else userBet[symbol] = amt;
        })

        if (isInvalidPayload) return logEventAndEmitResponse(socket, "bet", userBet, "Invalid Bet Payload");


        const totalBetAmount = Object.values(userBet).reduce((acc, val) => acc + val, 0);
        if (totalBetAmount < Number(GS.GAME_SETTINGS.min_amt!) || Number(totalBetAmount) > Number(GS.GAME_SETTINGS.max_amt)) {
            return logEventAndEmitResponse(socket, "bet", userBet, "Invalid Bet Amount");
        }
        if (totalBetAmount > info.bl) {
            return logEventAndEmitResponse(socket, "bet", userBet, "Insufficient Balance");
        }

        const matchId = `${curRndId.roundId}`;
        const userIp = getUserIP(socket)
        const plrTxnDtl = { game_id: info.gmId, operatorId: info.operatorId, token: info.token };
        const txnDtl = { id: matchId, bet_amount: totalBetAmount, game_id: info.gmId, user_id: info.urId, ip: userIp };

        // debit, update info and emit 
        const dbtTxn: any = await updateBalanceFromAccount(txnDtl, "DEBIT", plrTxnDtl);
        if (!dbtTxn) return socket.emit("betError", "Bet Cancelled By Upstream Server.")
        info.bl -= totalBetAmount;
        await setCache(socket.id, info);

        let roundBets = await getCache(matchId);
        if (!roundBets) roundBets = {};

        roundBets[info.urId] = { ...dbtTxn, ...info, userBet };
        await setCache(matchId, roundBets);

        const betObject = {
            user_id: info.urId,
            round_id: matchId,
            operator_id: info.operatorId,
            bet_amt: totalBetAmount,
            bet_values: userBet,
        }
        betlogger.info(JSON.stringify(betObject));
        await BetResults.create(betObject);
        socket.emit("info", { urId: info.urId, urNm: info.urNm, bl: info.bl, operatorId: info.operatorId });
        return socket.emit("bet_result", { message: "bet has been accepted successfully" });

    } catch (error: any) {
        failedBetLogger.error(JSON.stringify(error));
        console.error("error during placing bet", error.message);
        return socket.emit("betError", { message: "unable to place bet", error: error.message });
    }
}

export const settlementHandler = async (io: Namespace) => {
    try {
        const curRndId = gameLobby.getCurrentRoundId();
        const matchId = `${curRndId.roundId}`;
        const roundBets = await getCache(matchId);
        if (!roundBets || !Object.keys(roundBets).length) {
            return console.error("no bets found for roundId:", matchId);
        }

        const roundResult: IRoundResult = gameLobby.getRoundResult();
        const mainMults = GS.GAME_SETTINGS.main_mult ?? GAME_SETTINGS.main_mult;
        const sideMults = GS.GAME_SETTINGS.side_mult ?? GAME_SETTINGS.side_mult;

        // Side winner label: "+A" or "+B"
        const sideWinner = roundResult.winner === "PLAYER_A" ? "+A" : "+B";
        const sideHandType = roundResult.winner === "PLAYER_A"
            ? roundResult.handA.handType
            : roundResult.handB.handType;

        console.log("---------", roundResult.winner, sideWinner, sideHandType);

        for (const userId of Object.keys(roundBets)) {
            const userBets = roundBets[userId]?.userBet || {};
            let ttlWinAmt = 0;
            const detailedBets: any[] = [];

            for (const [betOn, stake] of Object.entries(userBets)) {
                if (!stake || Number(stake) <= 0) continue;

                let odds = 0;
                let profit = 0;
                let loss = Number(stake);

                // Main bet win (PLAYER_A or PLAYER_B)
                if (betOn === roundResult.winner) {
                    odds = Number(mainMults[roundResult.winner as "PLAYER_A" | "PLAYER_B"]);
                    profit = +(Number(stake) * odds - Number(stake)).toFixed(2);
                    loss = 0;
                }
                // Side bet win (+A or +B)
                else if (betOn === sideWinner) {
                    odds = Number(sideMults[sideHandType as keyof typeof sideMults]) || 0;
                    if (odds > 0) {
                        profit = +(Number(stake) * odds - Number(stake)).toFixed(2);
                        loss = 0;
                    } else {
                        profit = 0;
                        loss = Number(stake);
                    }
                }

                if (profit > 0) ttlWinAmt += profit + Number(stake);

                detailedBets.push({
                    bet_on: betOn,
                    stake: Number(stake),
                    odds,
                    profit: profit > 0 ? profit : 0,
                    loss: profit > 0 ? 0 : Number(stake),
                });
            }

            // Cap winnings
            const maxCo = Number(GS.GAME_SETTINGS.max_co) ?? GAME_SETTINGS.max_co;
            roundBets[userId]["winning_amount"] = Math.min(ttlWinAmt, maxCo);

            // CREDIT handling
            const plInfo: Info = await getCache(roundBets[userId].sid);
            if (roundBets[userId]["winning_amount"] > 0) {
                const playerDetails: IPlayerDetails = {
                    game_id: roundBets[userId]?.gmId,
                    operatorId: roundBets[userId]?.operatorId,
                    token: roundBets[userId]?.token
                };

                const cdtRes = await updateBalanceFromAccount(roundBets[userId], "CREDIT", playerDetails);
                if (!cdtRes) console.error("credit txn failed for user_id", userId);

                plInfo.bl += Number(roundBets[userId]["winning_amount"]);
                await setCache(plInfo.sid, plInfo);

                const winAmt = Number(roundBets[userId]["winning_amount"]).toFixed(2);
                io.to(plInfo.sid).emit("settlement", { winAmt, status: "WIN", winner: roundResult.winner, pair: sideWinner });
                setTimeout(() => {
                    io.to(plInfo.sid).emit("info", { urId: plInfo.urId, urNm: plInfo.urNm, bl: plInfo.bl, operatorId: plInfo.operatorId });
                }, 2000);
                setTimeout(() => {
                    io.to(plInfo.sid).emit("lastWin", { lastWin: winAmt });
                }, 13000);
            } else {
                io.to(plInfo.sid).emit("settlement", { winAmt: 0.00, status: "LOSS", winner: roundResult.winner, pair: sideWinner });
            }

            // Store settlement in DB
            const betAmt: number = Object.values<number>(userBets as Record<string, number>).reduce((acc, val) => acc + Number(val), 0);
            const stmtObj = {
                user_id: userId,
                round_id: matchId,
                operator_id: roundBets[userId]?.operatorId,
                bet_amt: isNaN(betAmt) ? 0 : betAmt,
                win_amt: Number(roundBets[userId]["winning_amount"] || 0),
                bet_values: userBets,
                settled_bets: detailedBets,
                round_result: roundResult,
                status: roundBets[userId]["winning_amount"] > 0 ? "WIN" : "LOSS",
                created_at: new Date()
            };

            settlementlogger.info(JSON.stringify(stmtObj));
            await Settlements.create(stmtObj);
        }

        return await delCache(matchId);

    } catch (error: any) {
        failedSettlementLogger.error(JSON.stringify(error));
        console.error("error during settlement", error.message);
        return io.emit("betError", { event: "settlement", message: "unable to process settlements", error: error.message });
    }
};


/* EMIT AS PAIR DOESN'T MEAN SIDE WINNINGS. ITS JUST TO SHOW WHICH SIDE WON.
   ACTUAL SIDE WINNINGS DEPENDS ON THE HAND TYPE. I.E. IF PLAYER_A WINS WITH A PAIR, 
   ALL +A BETS WILL BE PAID ACCORDING TO THE PAIR ODDS. IF PLAYER_B WINS WITH A FLUSH,
   ALL +B BETS WILL BE PAID ACCORDING TO THE FLUSH ODDS. IF ODDS=0, NO WINNINGS FOR SIDE BETS. 
*/

/* NOTE: IN CASE OF TIE, NO MAIN WINNINGS. SIDE BETS ARE SETTLED AS PER HAND TYPE OF PLAYER_A (OR PLAYER_B, AS THEY ARE SAME) */