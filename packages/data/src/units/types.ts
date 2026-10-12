/** A currency or point unit the family tracks balances in: US dollars, rupees, stars, minutes of screen time. */
export interface UnitDefinition {
    id: string;
    /** The short code balances are keyed by, upper case and unique: USD, NPR, XP. */
    code: string;
    name: string;
    /** May be empty. */
    symbol: string;
    /** Money can be converted and totalled across currencies; a point unit cannot. */
    isMonetary: boolean;
    /** Where the symbol sits beside the amount. `null` leaves it to the formatter: before for money, after otherwise. */
    symbolPlacement: 'before' | 'after' | null;
    /** Whether a space separates symbol and amount. `null` leaves it to the formatter. */
    symbolSpacing: boolean | null;
    /** `null` leaves it to the formatter: two places for money, none otherwise. */
    decimalPlaces: number | null;
}

export type NewUnitDefinition = Omit<UnitDefinition, 'id'>;
