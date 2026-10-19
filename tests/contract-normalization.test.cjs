const test = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../src/components/trading/contract-normalization.mjs");
const activityPromise = import("../src/components/trading/activity-helpers.mjs");

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

test("zero sell price is preserved instead of falling back to potential payout", async () => {
 const { normalizeDerivContract } = await modulePromise;
 const c=normalizeDerivContract({contract_id:10,buy_price:"25",sell_price:"0",payout:"46.13",status:"sold",is_sold:true});
 assert.equal(c.payout,0);
 assert.equal(c.profit,-25);
 assert.equal(c.outcome,"lost");
 assert.equal(c.status,"settled");
});
test("terminal loss cannot inherit a positive potential payout", async () => {
 const { normalizeDerivContract } = await modulePromise;
 const c=normalizeDerivContract({contract_id:11,buy_price:"25",payout:"46.13",status:"lost",is_expired:true});
 assert.equal(c.payout,0);
 assert.equal(c.profit,-25);
 assert.equal(c.outcome,"lost");
});
test("position adapter exposes normalized settled state for numeric and string flags", async () => {
 const { toPosition } = await activityPromise;
 const sold = toPosition({contract_id:"17578914379", contract_type:"DIGITUNDER", underlying:"Volatility 50 (1s) Index", buy_price:"25.00", payout:"46.13", profit:"21.13", status:"open", is_sold:"1", currency:"USD"});
 assert.equal(sold.status, "settled");
 assert.equal(sold.outcome, "won");
 assert.equal(sold.buyPrice, 25);
 assert.equal(sold.payout, 46.13);
 assert.equal(sold.profit, 21.13);
});
