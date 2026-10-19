const test = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../src/components/trading/contract-normalization.mjs");

test("normalizes string monetary fields and reconciles payout less stake", async () => {
 const { normalizeDerivContract } = await modulePromise;
 const c = normalizeDerivContract({contract_id:17578914379,contract_type:"DIGITUNDER",underlying:"Volatility 50 (1s) Index",buy_price:"25.00",payout:"46.13",profit:"21.13",status:"won",is_expired:1,currency:"USD"});
 assert.equal(c.contractId,"17578914379");
 assert.equal(c.stake,25);
 assert.equal(c.payout,46.13);
 assert.equal(c.profit,21.13);
 assert.equal(c.outcome,"won");
 assert.equal(c.status,"settled");
});
test("open contracts are not settled even if potential profit exists", async () => {
 const { normalizeDerivContract } = await modulePromise;
 const c=normalizeDerivContract({contract_id:7,buy_price:"25",payout:"46.13",profit:"21.13",status:"open"});
 assert.equal(c.settled,false);
 assert.equal(c.outcome,"open");
});
test("invalid monetary fields stay unknown instead of becoming zero", async () => {
 const { normalizeDerivContract, parseDerivNumber } = await modulePromise;
 assert.equal(parseDerivNumber(""),null);
 assert.equal(parseDerivNumber("x"),null);
 assert.equal(normalizeDerivContract({profit:"unknown",status:"won",is_sold:1}).outcome,"unknown");
});
test("zero-payout loss supports string flags", async () => {
 const { normalizeDerivContract } = await modulePromise;
 const c=normalizeDerivContract({contract_id:9,buy_price:"25",payout:"0",profit:"-25",status:"lost",is_expired:"1"});
 assert.equal(c.outcome,"lost");
 assert.equal(c.profit,-25);
 assert.equal(c.settled,true);
});
