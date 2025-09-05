import type { ICardInfo } from "../interfaces";

export class GenerateResults {
    private values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    private suits = ["H", "C", "D", "S"];
    private deck: ICardInfo[];
    private result;

    constructor() {
        this.deck = this.shuffleDeck(this.generateDeck());
        const { playerACards, playerBCards } = this.pickBothHandCards();

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

    private shuffleDeck(deck: ICardInfo[]) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    private pickBothHandCards(): { playerACards: ICardInfo[], playerBCards: ICardInfo[] } {
        const set = new Set<string>();
        const playerCards: ICardInfo[] = []
        while (playerCards.length < 6) {
            const card = this.deck[Math.floor(Math.random() * this.deck.length)];
            if (!set.has(card.card)) {
                set.add(card.card);
                playerCards.push(card);
            }
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

            // if rank is same, compare card values in descending order
            const sortedA = [...handACards].sort((a, b) => b.val - a.val);
            const sortedB = [...handBCards].sort((a, b) => b.val - a.val);

            for (let i = 0; i < 3; i++) {
                if (sortedA[i].val > sortedB[i].val) return "PLAYER_A";
                if (sortedB[i].val > sortedA[i].val) return "PLAYER_B";
            }

            const suitRank: Record<string, number> = { "C": 1, "D": 2, "H": 3, "S": 4 }

            for (let i = 0; i < 3; i++) {
                const suitA = suitRank[sortedA[i].suit];
                const suitB = suitRank[sortedB[i].suit];

                if (suitA > suitB) return "PLAYER_A";
                if (suitB > suitA) return "PLAYER_B";
            }

            return "TIE";
        }
    }

    getResult = () => this.result;
}