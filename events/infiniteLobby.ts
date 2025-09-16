import type { Namespace } from "socket.io";
import type { ICardInfo, IRoundResult } from "../interfaces";
import { settlementHandler } from "../services/handlers";
import { Lobbies } from "../models/lobbies";
import { createLogger } from "../utilities/logger";
import { GenerateResults } from "../utilities/roundResult";
const logger = createLogger("lobbies", "jsonl");

const enum EStatus { ss = "STARTED", pb = "PLACE_BET", cb = "COLLECT_BET", sc = "SHOW_CARDS", ed = "ENDED" };
export const enum EStatusCode { pb = 1, cb = 2, sc = 3, ed = 4 };
const enum EStatusInterval { pb = 15, cb = 6, sc = 8, ed = 6 };
// const enum EStatusInterval { pb = 0, cb = 0, sc = 5, ed = 0 };

export class InfiniteGameLobby {
    private io: Namespace;
    private status!: EStatus;
    private statusCode!: EStatusCode;
    private roundId!: number;
    private roundResult!: IRoundResult;
    private prevRoundResults: IRoundResult[] = [];

    constructor(io: Namespace) {
        this.io = io;
        this.initGameLoop();
    }

    async initGameLoop(): Promise<any> {
        await this.mySleep(2 * 1000)
        await this.loadRoundResult();
        await this.gameLoop()
    }

    async gameLoop(): Promise<any> {

        this.setCurrentRoundId();
        this.setCurrentStatus(EStatus.pb, EStatusCode.pb);
        await this.sleep(EStatusInterval.pb);

        this.setCurrentStatus(EStatus.cb, EStatusCode.cb);
        await this.sleep(EStatusInterval.cb);

        this.generateRoundResult();
        this.storeRoundResults();

        setTimeout(async () => {
            await settlementHandler(this.io)
        }, 2500);
        this.setCurrentStatus(EStatus.sc, EStatusCode.sc);
        await this.sleepWithCards(EStatusInterval.sc);
        this.emitRoundResult();

        this.setCurrentStatus(EStatus.ed, EStatusCode.ed);
        await this.sleep(EStatusInterval.ed);

        await Lobbies.create(this.roundId, this.roundResult);
        return this.gameLoop();
    }

    public getCurrentRoundId(): { roundId: number } { return { roundId: this.roundId }; }
    public getCurrentStatus(): { status: EStatus, statusCode: EStatusCode } { return { status: this.status, statusCode: this.statusCode }; }
    public getRoundResult(): IRoundResult { return this.roundResult; }
    public getPrevRoundResults(): IRoundResult[] { return this.prevRoundResults; }

    private mySleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    private async sleep(seconds: number): Promise<void> {
        for (let i = seconds; i > 0; i--) {
            this.emitIntervalSeconds(i);
            await this.mySleep(1000);
        }
    }
    private async sleepWithCards(seconds: number): Promise<void> {
        const aCards = this.roundResult.handA.cards as ICardInfo[]
        const bCards = this.roundResult.handB.cards as ICardInfo[]
        const a = aCards.map(c => c.card);
        const b = bCards.map(c => c.card);
        for (let i = seconds; i > 0; i--) {
            this.emitRroundResultsWithIntervals(i, a, b);
            await this.mySleep(1000);
        }
    }

    private setCurrentRoundId() { this.roundId = Date.now(); }
    private setCurrentStatus(status: EStatus, statusCode: EStatusCode) { this.status = status; this.statusCode = statusCode; }
    private storeRoundResults() {
        if (this.prevRoundResults.length >= 3) this.prevRoundResults.shift();
        this.prevRoundResults.push(this.roundResult);
    }
    private async loadRoundResult() {
        if (this.prevRoundResults.length < 15) {
            // @ts-ignore
            this.prevRoundResults = await Lobbies.loadPrevThree();
        }
    }

    private emitIntervalSeconds(t: number) { return this.io.emit("message", { data: `round:${this.roundId}:${this.statusCode}:${t}` }); }
    private emitRroundResultsWithIntervals(t: number, a: string[], b: string[]) { return this.io.emit("message", { data: `round:${this.roundId}:${this.statusCode}:${t}:[${a}]:[${b}]` }) }
    private emitRoundResult() { return this.io.emit("round_result", { roundId: this.roundId, winner: this.roundResult.winner, pair: `+${this.roundResult.winner.split("_")[1]}` }) }
    private generateRoundResult() {
        this.roundResult = {
            ... new GenerateResults().getResult(),
            roundId: this.roundId,
        }
        logger.info(JSON.stringify(this.roundResult));
    }
}

