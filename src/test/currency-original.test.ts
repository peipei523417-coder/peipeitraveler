import { describe, it, expect } from "vitest";
import { parseAmountInput, sumPerPerson, itemAmounts, currencyDecimals, ProjectCurrency } from "@/lib/currency";

const EUR: ProjectCurrency = { code: "EUR", name: "Euro", symbol: "€", rate: 0.028, isCustom: false };
const eurItem = (a: number, persons = 1, snap = 0.028) => ({
  price: Math.round(a / snap), persons, originalAmount: a, originalCurrency: "EUR", exchangeRateSnapshot: snap,
});

describe("original amount bookkeeping", () => {
  it("parses €7.92 and €1.50 without truncation", () => {
    expect(parseAmountInput("7.92", 2)).toBe(7.92);
    expect(parseAmountInput("1.50", 2)).toBe(1.5);
  });
  it("uses currency decimals: EUR 2, JPY/KRW 0", () => {
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KRW")).toBe(0);
  });
  it("shows €7.92 back exactly", () => {
    expect(itemAmounts(eurItem(7.92), EUR).local).toBe(7.92);
  });
  it("project rate change keeps the original amount", () => {
    expect(itemAmounts(eurItem(7.92), { ...EUR, rate: 0.05 }).local).toBe(7.92);
  });
  it("three NT$100 split by 3 people totals NT$100, not 99", () => {
    const items = [1, 2, 3].map(() => ({ price: 100, persons: 3 }));
    expect(sumPerPerson(items, null).twd).toBe(100);
  });
  it("TWD-only legacy items unchanged", () => {
    expect(sumPerPerson([{ price: 500, persons: 2 }], null).twd).toBe(250);
  });
  it("mixed currencies convert before adding", () => {
    const t = sumPerPerson([eurItem(10), { price: 100, persons: 1 }], EUR);
    expect(t.local).toBe(12.8); // 10 + 100*0.028
  });
});
