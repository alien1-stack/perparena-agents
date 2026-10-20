#!/usr/bin/env bash
# 004 repro — read-only. Run inside a fresh clone of somnia-chain/dreamdex-bot-kit after `npm install`.
# 1) What the doctor prints for XRP / NEAR:
NETWORK=hideki PRIVATE_KEY= npm run -s perp:doctor 2>&1 | grep -E "^(XRP|NEAR|ADA|SUI)-PERP"
# 2) The same books, read straight from the pools at the head block:
for pool in 0x7058579f3248559963f79adb937c6de9f953e060 0x1cd15ae8bff0fe0a7f49233be8b90734775ba454; do
  for side in true false; do
    data=$(node -e "const {encodeFunctionData,parseAbi}=require('viem');console.log(encodeFunctionData({abi:parseAbi(['function getBookLevels(bool,uint64) view returns ((uint256,uint256)[])']),functionName:'getBookLevels',args:[$side,1n]}))")
    res=$(curl -s -X POST https://api.hideki2.infra.testnet.somnia.network -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$pool\",\"data\":\"$data\"},\"latest\"]}")
    node -e "const r=JSON.parse(process.argv[1]).result;const p=BigInt('0x'+r.slice(2+128,2+192));console.log('$pool', $side?'best bid':'best ask', Number(p)/1e18)" "$res"
  done
done
