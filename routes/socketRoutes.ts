import type { Namespace, Socket } from "socket.io";
import { placeBetHandler } from "../services/handlers";
import { gameLobby } from "../index";
import { EStatusCode } from "../events/infiniteLobby";
import type { Info } from "../interfaces";
import { delCache, getCache } from "../cache/redis";
import { Settlements } from "../models/settlements";

export const socketRouter = async (io: Namespace, socket: Socket) => {
    try {
        console.log("socket connected with id:", socket.id);
        const gameState = { ...gameLobby.getCurrentRoundId(), ...gameLobby.getCurrentStatus(), prevRoundResults: gameLobby.getPrevRoundResults(), roundResult: gameLobby.getCurrentStatus().statusCode >= EStatusCode.sc ? gameLobby.getRoundResult() : {} }
        let lastWin: any;
        const info: Info = await getCache(socket.id);
        if (info) {
            lastWin = await Settlements.fetchLastWin(info.urId, info.operatorId);
            lastWin = lastWin.win_amt;
        }
        setTimeout(() => {
            socket.emit("game_state", gameState);
            if (lastWin) socket.emit('lastWin', { lastWin: lastWin && typeof lastWin === "number" ? Number(lastWin).toFixed(2) : "0.00" });
        }, 100);

        socket.on("message", async (data: string) => {
            const [event, roundId, betData] = data.split(":");
            switch (event) {
                case "PB":
                    await placeBetHandler(io, socket, roundId, betData)
                    break;
                default:
                    socket.emit("betError", "invalid event");
                    break;
            }
        });
        return
    } catch (error) {
        console.error("error", error);
    }

    socket.on("disconnect", async (reason: string) => {
        console.log(`socket disconnected with id: ${socket.id}, reason: ${reason}`);
        const info: Info = await getCache(socket.id);
        await delCache(`${info?.urId}:${info?.operatorId}`);
    });
}