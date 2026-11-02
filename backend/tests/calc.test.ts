import { describe, expect, it } from 'vitest';
import { calculatePurchase, calculateSale, proportionalValue } from '../src/services/calc.service';
import { add, allocate, mul, percentOf, round } from '../src/utils/money';

describe('money helpers', () => {
  it('avoids floating point errors', () => {
    expect(add(0.1, 0.2)).toBe(0.3);
    expect(round(1.005)).toBe(1.01);
    expect(mul(19.99, 3)).toBe(59.97);
    expect(percentOf(100, 18)).toBe(18);
  });

  it('allocates totals exactly', () => {
    const parts = allocate(10, [1, 1, 1]);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
    expect(add(...parts)).toBe(10);
  });
});

describe('calculateSale', () => {
  it('applies line and bill discounts and tax', () => {
    const t = calculateSale(
      [
        { qty: 2, unitPrice: 500, discount: 50, taxRate: 18 },
        { qty: 1, unitPrice: 1000, taxRate: 18 },
      ],
      100,
      true,
    );
    expect(t.subtotal).toBe(2000);
    expect(t.itemDiscount).toBe(50);
    expect(t.billDiscount).toBe(100);
    expect(t.taxableAmount).toBe(1850);
    // bill discount split 950:1000 -> 48.72 / 51.28
    expect(t.lines[0].billDiscountShare + t.lines[1].billDiscountShare).toBeCloseTo(100, 5);
    expect(t.taxAmount).toBe(333);
    expect(t.grandTotal).toBe(2183);
  });

  it('ignores tax rates when tax is disabled', () => {
    const t = calculateSale([{ qty: 1, unitPrice: 100, taxRate: 18 }], 0, false);
    expect(t.taxAmount).toBe(0);
    expect(t.grandTotal).toBe(100);
  });

  it('rejects discounts larger than the amount', () => {
    expect(() => calculateSale([{ qty: 1, unitPrice: 100, discount: 150 }], 0, false)).toThrow();
    expect(() => calculateSale([{ qty: 1, unitPrice: 100 }], 150, false)).toThrow();
  });
});

describe('calculatePurchase', () => {
  it('computes landed cost including shipping across paid + free units', () => {
    const t = calculatePurchase(
      [
        { qty: 10, freeQty: 0, unitCost: 100 },
        { qty: 4, freeQty: 1, unitCost: 250 },
      ],
      200,
      0,
      true,
    );
    expect(t.grandTotal).toBe(2200);
    expect(t.lines[0].chargesShare).toBe(100);
    expect(t.lines[0].landedUnitCost).toBe(110);
    expect(t.lines[1].landedUnitCost).toBe(220); // (1000 + 100) / 5
  });
});

describe('proportionalValue', () => {
  it('returns the exact remainder on the final return', () => {
    const first = proportionalValue(100, 0, 3, 0, 1);
    const second = proportionalValue(100, first, 3, 1, 1);
    const third = proportionalValue(100, add(first, second), 3, 2, 1);
    expect(add(first, second, third)).toBe(100);
  });
});
