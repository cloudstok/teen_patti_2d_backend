import type { Namespace } from "socket.io";
import type { ICardInfo, IRoundResult } from "../interfaces";
import { settlementHandler } from "../services/handlers";

const enum EStatus { ss = "STARTED", pb = "PLACE_BET", cb = "COLLECT_BET", sc = "SHOW_CARDS", ed = "ENDED" };
export const enum EStatusCode { pb = 1, cb = 2, sc = 3, ed = 4 };
const enum EStatusInterval { pb = 15, cb = 4, sc = 6, ed = 5 };
// const enum EStatusInterval { pb = 0, cb = 0, sc = 0, ed = 0 };

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
        await this.gameLoop()
    }

    async gameLoop(): Promise<any> {

        this.setCurrentRoundId();
        this.emitStatus();
        this.setCurrentStatus(EStatus.pb, EStatusCode.pb);
        await this.sleep(EStatusInterval.pb);

        this.setCurrentStatus(EStatus.cb, EStatusCode.cb);
        this.emitStatus();
        await this.sleep(EStatusInterval.cb);

        this.generateRoundResult();
        this.storeRoundResults();

        this.setCurrentStatus(EStatus.sc, EStatusCode.sc);
        this.emitStatus();
        this.emitRoundResults()
        await this.sleep(EStatusInterval.sc);

        this.setCurrentStatus(EStatus.ed, EStatusCode.ed);
        this.emitStatus();
        await settlementHandler(this.io)
        await this.sleep(EStatusInterval.ed);

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

    private setCurrentRoundId() { this.roundId = 1745227259107/* Date.now();*/ }
    private setCurrentStatus(status: EStatus, statusCode: EStatusCode) { this.status = status; this.statusCode = statusCode; console.log(status, statusCode); }
    private storeRoundResults() {
        if (this.prevRoundResults.length >= 3) this.prevRoundResults.shift();
        this.prevRoundResults.push(this.roundResult);
    }

    private emitStatus() { return this.io.emit("message", { event: "game_status", status: this.status }); }
    private emitRoundResults() { return this.io.emit("message", { event: "round_result", roundResult: this.roundResult }); }
    private emitIntervalSeconds(t: number) { return this.io.emit("message", `round:${this.roundId}:${this.statusCode}:${t}`); }


    private generateRoundResult() {
        this.roundResult = {
            ... new GenerateResults().getResult(),
            roundId: this.roundId,
        }
    }
}

class GenerateResults {
    private values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    private suits = ["H", "C", "D", "S"];
    private deck: ICardInfo[];
    private result;

    constructor() {
        this.deck = this.shuffleDeck(this.generateDeck());
        const { playerACards, playerBCards } = this.pickBothHandCards(this.deck);
        this.result = {
            playerACards,
            playerBCards,
            winner: this.determineWinner(playerACards, playerBCards),
        }
    }

    private generateDeck(): ICardInfo[] {
        const deck: ICardInfo[] = []
        for (const suit of this.suits) {
            for (const val of this.values) {
                deck.push({ suit, val, card: `${suit}${val}` });
            }
        }
        return deck;
    }

    // by randomly picking cards from shuffled deck  
    // ^ed shannon entropy  
    private shuffleDeck(deck: ICardInfo[]) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    // by sequence of start and last cards
    // less shannon entropy
    // private pickBothHandCards(shuffledDeck: ICardInfo[]): { playerACards: ICardInfo[], playerBCards: ICardInfo[] } {
    //     const playerACards = [];
    //     const playerBCards = [];
    //     for (let i = 0; i < 3; i++) {
    //         playerACards.push(shuffledDeck[(i + 1) * 2]);
    //         playerBCards.push(shuffledDeck[shuffledDeck.length - ((i + 1) * 2)]);
    //     }
    //     return { playerACards, playerBCards }
    // }

    private pickBothHandCards(shuffledDeck: ICardInfo[]): { playerACards: ICardInfo[], playerBCards: ICardInfo[] } {
        const set = new Set<ICardInfo>();
        while (set.size < 6) {
            set.add(this.deck[Math.floor(Math.random() * this.deck.length)]);
        }
        return { playerACards: this.deck.slice(0, 3), playerBCards: this.deck.slice(3, 6) }
    }


    private getCardValues = (cards: ICardInfo[]): number[] => cards.map(c => c.val);
    private getCardSuits = (cards: ICardInfo[]): string[] => cards.map(c => c.suit);

    private evaluateHand(cards: ICardInfo[]) {
        const values = this.getCardValues(cards);
        const suits = this.getCardSuits(cards);
        const sortedValues = values.sort((a, b) => a - b);

        const isSequence = sortedValues[0] + 1 === sortedValues[1] && sortedValues[1] + 1 === sortedValues[2];
        const isTrail = values[0] === values[1] && values[1] === values[2];
        const isFlush = suits[0] === suits[1] && suits[1] === suits[2];

        if (isTrail) {
            return { handType: "Trail", rank: 4, value: values[0] };
        } else if (isSequence && isFlush) {
            return { handType: "Pure Sequence", rank: 3, value: sortedValues[2] };
        } else if (isSequence) {
            return { handType: "Sequence", rank: 2, value: sortedValues[2] };
        } else if (isFlush) {
            return { handType: "Flush", rank: 1, value: Math.max(...values) };
        } else {
            let highCard = Math.max(...values);
            return { handType: "High Card", rank: 0, value: highCard };
        }
    }

    private determineWinner(handACards: ICardInfo[], handBCards: ICardInfo[]): "PLAYER_A" | "PLAYER_B" | "TIE" {

        const hand1 = this.evaluateHand(handACards);
        const hand2 = this.evaluateHand(handBCards);

        if (hand1.rank > hand2.rank) {
            return "PLAYER_A";
        } else if (hand2.rank > hand1.rank) {
            return "PLAYER_B";
        } else {
            // If ranks are equal, compare values
            if (hand1.value > hand2.value) {
                return "PLAYER_A";
            } else if (hand2.value > hand1.value) {
                return "PLAYER_B";
            } else {
                return "TIE";
            }
        }
    }

    getResult = () => this.result;
}