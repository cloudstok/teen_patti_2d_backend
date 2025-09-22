import type { ICardInfo, IDetermineWinner } from "../interfaces";

export class GenerateResults {
    private values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    private suits = ["H", "C", "D", "S"];
    private deck: ICardInfo[];
    private result;

    constructor() {
        this.deck = this.shuffleDeck(this.generateDeck());
        const { playerACards, playerBCards } = {
            playerACards: [{
                "val": 11,
                "card": "S11",
                "suit": "S"
            },
            {
                "val": 11,
                "card": "S11",
                "suit": "S"
            },
            {
                "val": 9,
                "card": "C9",
                "suit": "C"
            }],
            playerBCards: [
                {
                    "val": 5,
                    "card": "C5",
                    "suit": "C"
                },
                {
                    "val": 5,
                    "card": "C5",
                    "suit": "C"
                },
                {
                    "val": 4,
                    "card": "C4",
                    "suit": "C"
                }
            ]
        }
        // this.pickBothHandCards();

        const winner = this.determineWinner(playerACards, playerBCards);
        this.result = {
            ...winner,
            handA: { ...winner.handA, cards: playerACards },
            handB: { ...winner.handB, cards: playerBCards },
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
            return { handType: "TRIO", rank: 4, value: values[0] };
        } else if (isSequence && isFlush) {
            return { handType: "STRAIGHT_FLUSH", rank: 3, value: sortedValues[2] };
        } else if (isSequence) {
            return { handType: "STRAIGHT", rank: 2, value: sortedValues[2] };
        } else if (isFlush) {
            return { handType: "FLUSH", rank: 1, value: Math.max(...values) };
        } else {
            let highCard = Math.max(...values);
            return { handType: "HIGH_CARD", rank: 0, value: highCard };
        }
    }

    private determineWinner(handACards: ICardInfo[], handBCards: ICardInfo[]): IDetermineWinner {

        const handA = this.evaluateHand(handACards);
        const handB = this.evaluateHand(handBCards);
        if (handA.rank > handB.rank) {
            return { winner: "PLAYER_A", handA, handB };
        } else if (handB.rank > handA.rank) {
            return { winner: "PLAYER_B", handA, handB };
        } else {

            // if rank is same, compare card values in descending order
            const sortedA = [...handACards].sort((a, b) => b.val - a.val);
            const sortedB = [...handBCards].sort((a, b) => b.val - a.val);

            for (let i = 0; i < 3; i++) {
                if (sortedA[i].val > sortedB[i].val) return { winner: "PLAYER_A", handA, handB };
                if (sortedB[i].val > sortedA[i].val) return { winner: "PLAYER_B", handA, handB };
            }

            const suitRank: Record<string, number> = { "C": 1, "D": 2, "H": 3, "S": 4 }

            for (let i = 0; i < 3; i++) {
                const suitA = suitRank[sortedA[i].suit];
                const suitB = suitRank[sortedB[i].suit];

                if (suitA > suitB) return { winner: "PLAYER_A", handA, handB };
                if (suitB > suitA) return { winner: "PLAYER_B", handA, handB };
            }

            return { winner: "TIE", handA, handB };
        }
    }

    getResult = () => this.result;
}