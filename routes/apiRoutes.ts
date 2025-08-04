import { Router } from "express";
import { loadConfig } from "../utilities/loadConfig";
import type { IGameSettings } from "../interfaces";
import { Settlements } from "../models/settlements";

export const apiRouter = Router();

apiRouter.get("/load-config", async (req: any, res: any) => {
    try {
        // @ts-ignore
        const settings: IGameSettings = (await loadConfig());
        return res.status(200).send({ statusCode: 200, settings, message: "settings loaded successfully" })
    } catch (error: any) {
        console.error("error occured", error.message);
    }
});

apiRouter.get("/bet-history", async (req: any, res: any) => {
    try {
        let { user_id, operator_id, limit } = req.query;
        if (!user_id || !operator_id) throw new Error("user_id and operator_id are required");
        if (limit) limit = Number(limit);

        const history = await Settlements.find(user_id, operator_id, limit);

        const transformedHistory = history.flatMap((entry: any) => {
            const betValues = entry.bet_values || {};
            const roundResult = entry.round_result || {};
            const totalWinAmount = entry.win_amt || 0;
            const roundId = entry.round_id;

            const winnerTeam = roundResult.winner;
            const totalWinningStake = betValues[winnerTeam] || 0;

            return Object.entries(betValues)
                .filter(([_, stake]: any) => stake > 0)
                .map(([teamKey, stake]: any) => {
                    let odds = 0;
                    let profit = 0;
                    let loss = stake;

                    if (teamKey === winnerTeam) {
                        odds = totalWinningStake > 0 ? +(totalWinAmount / totalWinningStake).toFixed(2) : 0;
                        profit = +(stake * odds - stake).toFixed(2);
                        loss = 0;
                    }

                    return {
                        round_id: roundId,
                        bet_on: teamKey,
                        odds,
                        stake,
                        profit,
                        loss
                    };
                });
        });

        return res.status(200).send({
            statusCode: 200,
            history: transformedHistory,
            message: "bets history split by team"
        });
    } catch (error: any) {
        console.error("error occurred", error.message);
        return res.status(500).send({
            statusCode: 500,
            error: error.message,
            message: "unable to fetch bets history"
        });
    }
});

apiRouter.get("/match-history", async (req: any, res: any) => {
    try {
        const { user_id, operator_id, lobby_id } = req.query;

        if (!user_id || !operator_id || !lobby_id) {
            throw new Error("user_id, lobby_id and operator_id are required");
        }

        const history = await Settlements.findByRoundId(user_id, operator_id, lobby_id);
        const roundResult = history.round_result || {};
        const winner = roundResult?.winner || "UNKNOWN";

        const finalData: any = {
            lobby_id: history.round_id,
            user_id: history.user_id,
            operator_id: history.operator_id,
            total_bet_amount: history.bet_amt,
            winner: winner,
            DRAGON_SCORE: roundResult?.DRAGON?.runs || 0,
            TIGER_SCORE: roundResult?.TIGER?.runs || 0,
            LION_SCORE: roundResult?.LION?.runs || 0,
            bet_time: history.created_at
        };

        // Add Bet1, Bet2, etc. only for bets placed
        let betIndex = 1;
        for (const [team, amount] of Object.entries(history.bet_values || {})) {
            if (amount && amount as number > 0) {
                finalData[`Bet${betIndex}`] = {
                    team: team,
                    bet_amount: amount,
                    status: team === winner ? "WIN" : "LOSS",
                    win_amount: team === winner ? history.win_amt : 0
                };
                betIndex++;
            }
        }

        return res.status(200).send({
            status: true,
            data: finalData
        });
    } catch (error: any) {
        console.error("error occurred", error.message);
        return res.status(500).send({
            status: false,
            error: error.message,
            message: "Unable to fetch match history"
        });
    }
});
