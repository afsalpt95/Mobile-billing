import { describe, expect, it } from 'vitest';
import { add, calculateBill, paymentSummary } from './money';

describe('calculateBill (mirror of backend)', () => {
  it('matches the backend reference example', () => {
    const t = calculateBill(
      [
        { qty: 2, unitPrice: 500, discount: 50, taxRate: 18 },
        { qty: 1, unitPrice: 1000, taxRate: 18 },
      ],
      100,
      true,
    );
    expect(t.subtotal).toBe(2000);
    expect(t.taxable).toBe(1850);
    expect(t.tax).toBe(333);
    expect(t.grandTotal).toBe(2183);
  });

  it('handles decimals safely', () => {
    expect(add(0.1, 0.2)).toBe(0.3);
    expect(calculateBill([{ qty: 3, unitPrice: 19.99 }], 0, false).grandTotal).toBe(59.97);
  });
});

describe('paymentSummary', () => {
  it('gives change only from cash', () => {
    expect(paymentSummary(500, [{ amount: 600, isCash: true }])).toMatchObject({ applied: 500, changeDue: 100, balanceDue: 0, invalidOverpay: false });
    expect(paymentSummary(500, [{ amount: 600, isCash: false }]).invalidOverpay).toBe(true);
  });

  it('computes balance for partial payment', () => {
    expect(paymentSummary(250, [{ amount: 100, isCash: false }])).toMatchObject({ applied: 100, balanceDue: 150 });
  });
});
