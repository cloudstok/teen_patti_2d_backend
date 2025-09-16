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
        if (!roundBets || !Object.keys(roundBets).length) return console.error("no bets found for roundId:", matchId);

        const roundResult: IRoundResult = gameLobby.getRoundResult();
        const winner = `+${roundResult.winner.split("_")[1]}`
        const mainMults = GS.GAME_SETTINGS.main_mult ?? GAME_SETTINGS.main_mult;
        const sideMults = GS.GAME_SETTINGS.side_mult ?? GAME_SETTINGS.side_mult;
        let sideWinner = roundResult.winner == "PLAYER_A" ? roundResult.handA.handType : roundResult.handB.handType;

        Object.keys(roundBets).forEach(userId => {
            let ttlWinAmt = 0

            const userBets = roundBets[userId]?.userBet;
            console.log(roundBets[userId], userBets, roundResult, sideWinner);
            console.log("");
            if (userBets[roundResult.winner]) {
                console.log(roundResult.winner, userBets[roundResult.winner], mainMults[roundResult.winner as "PLAYER_A" | "PLAYER_B"]);
                const mainWin = Number(userBets[roundResult.winner]) * Number(mainMults[roundResult.winner as "PLAYER_A" | "PLAYER_B"]);
                console.log("mainWin", mainWin);
                ttlWinAmt += mainWin;
            }
            if (userBets[winner]) {
                console.log(userBets[winner], sideMults[sideWinner as keyof typeof sideMults]);
                const sideWin = Number(userBets[winner]) * (Number(sideMults[sideWinner as keyof typeof sideMults]) || 0);
                console.log("sideWin", sideWin);
                ttlWinAmt += sideWin;
            }

            const maxCo = Number(GS.GAME_SETTINGS.max_co) ?? GAME_SETTINGS.max_co;
            roundBets[userId]["winning_amount"] = Math.min(ttlWinAmt, maxCo);
            console.log(roundBets[userId]["winning_amount"], "final win amount");
        })

        Object.keys(roundBets).forEach(async (userId) => {
            if (roundBets[userId]["winning_amount"]) {

                const playerDetails: IPlayerDetails = {
                    game_id: roundBets[userId]?.gmId,
                    operatorId: roundBets[userId]?.operatorId,
                    token: roundBets[userId]?.token
                }
                const cdtRes = await updateBalanceFromAccount(roundBets[userId], "CREDIT", playerDetails);
                if (!cdtRes) console.error("credit txn failed for user_id", userId);

                let plInfo: Info = await getCache(roundBets[userId].sid);
                plInfo.bl += Number(roundBets[userId]["winning_amount"] || 0);
                await setCache(plInfo.sid, plInfo);
                const winAmt = Number(roundBets[userId]["winning_amount"]).toFixed(2) || "0.00";
                io.to(plInfo.sid).emit("info", { urId: plInfo.urId, urNm: plInfo.urNm, bl: plInfo.bl, operatorId: plInfo.operatorId })
                io.to(plInfo.sid).emit("settlement", { winAmt, status: "WIN", winner: roundResult.winner, pair: winner })
            } else {
                io.to(roundBets[userId].sid).emit("settlement", { winAmt: 0.00, status: "LOSS", winner: roundResult.winner, pair: winner })
            }

            const userBet = roundBets[userId].userBet
            let betAmt = 0;
            Object.keys(userBet).map(symbol => betAmt += Number(userBet[symbol]))

            const stmtObj = {
                user_id: userId,
                round_id: matchId,
                operator_id: roundBets[userId]?.operatorId,
                bet_amt: isNaN(betAmt) ? 0 : betAmt,
                win_amt: Number(roundBets[userId]["winning_amount"] || 0),
                bet_values: roundBets[userId].userBet,
                round_result: roundResult,
                status: roundBets[userId]["winning_amount"] ? "WIN" : "LOSS"
            }
            settlementlogger.info(JSON.stringify(stmtObj));
            await Settlements.create(stmtObj);
        });

        return await delCache(matchId);

    } catch (error: any) {
        failedSettlementLogger.error(JSON.stringify(error));
        console.error("error during settlement", error.message);
        return io.emit("betError", { event: "settlement", message: "unable to process settlements", error: error.message })
    }
}