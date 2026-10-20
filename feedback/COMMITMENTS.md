# Commitments for unpublished feedback items

These items are written and reproduced but not published yet, to keep them private until they are submitted on DoraHacks. Each line is `sha256sum` of the exact file that will be published. Anyone can verify the hash once the file is revealed. The commit time of this file proves when the item existed.

```
b62e605c7c03be6cf5815fb558209a95d255b407676f596008cd13abac8a300b  item 019 report (.md)
cdb29232d4cb1053c84519dcbab28691d8ea492379f820047274af6c83019f39  item 019 repro script
f34aa37d88fd3ae1ad36a2c51a00fd519656405ef7c77dec0e731edb093a5bfd  item 020 report (.md)
ccdcb59751f066141858618ee491f565b493182ae9fa10ee58447f235f6e89b7  item 020 repro script
06af90f4e41e27e2fbfcbd8df6f2f2415aef811c0043b94081b8cb64a81432f3  item 021 report (.md)
c21d75a1c999479d9862fd4b3cf6c636079afece7e1e403f0e43e6cc489fefc0  item 021 repro script
e68e520fd9947fbcd4efa567077e3e74f2d3dff74e337d7fd2eb6d314703f306  item 022 report (.md)
17310e9288168abdf33989ee3964ab073bbeeae929074e85f194b9c042cbbe8a  item 022 repro script
069378e10c46b8ba36d36c73491ae4626e56afc6d85f41b2f00fa43e5de2d07f  item 023 report (.md)
fc6fbdca0eca4f06704decacac83122833d51350b2d7fb7179e9a14b418f15c3  item 023 repro script
e8a1286ffc04841b029c1b384106609d04602ea85f30c930d2eb6f3317324e63  item 024 report (.md)
591532ea21e12ee465a1517a0e091df93e6ba73f720e81e01a2a854eb71eeb56  item 024 repro script
943ec6affe62fff7d9fc8cb1f552e71557d02035382f9d1ba3532dc5accc8c1a  item 025 report (.md)
97268a6a292a4135389d7f1715727050fafb5b6f20845ebe9e14162d630dde87  item 025 repro script
```

## Status and how to verify (added after the reveal)

Each hash above commits to the **original text** of the item, not to whatever the file says today. Several reports were edited after they were committed: an `## Evidence` section was added to 019-021 at reveal, every item's `## Environment` section was rewritten to the bounty template (SDK, network, wallet), and 020 was merged into 019. 020 and 021 were then withdrawn (`../withdrawn/`). None of the repro scripts changed. Run these from the repository root; each command should print the hash on the matching line above.

| Item | Original text is in | Command |
|---|---|---|
| 019 report | `feedback/commitments/019-docs-adl-order-is-leverage-not-profit.md` (byte-exact original; the live `feedback/019-*.md` now also has the added Evidence section, the new Environment block and the merged 020 section, so it no longer hashes to the commitment) | `sha256sum feedback/commitments/019-docs-adl-order-is-leverage-not-profit.md` |
| 019 repro | `feedback/019-repro.mts` (unchanged) | `sha256sum feedback/019-repro.mts` |
| 020 report | `withdrawn/020-btc-long-adl-side-never-ranked.md` (unchanged since reveal; the original is that file minus the Evidence section added at reveal) | `python3 -c "import re,hashlib;s=open('withdrawn/020-btc-long-adl-side-never-ranked.md').read();print(hashlib.sha256(re.sub(r'## Evidence\\n.*?\\n\\n(?=## Environment)','',s,flags=re.S).encode()).hexdigest())"` |
| 020 repro | `withdrawn/020-repro.mts`, and byte-identical `feedback/019-repro-b.mts` | `sha256sum withdrawn/020-repro.mts feedback/019-repro-b.mts` |
| 021 report | `withdrawn/021-position-analytics-truncates-pnl-bank-floors.md` (same rule as 020) | `python3 -c "import re,hashlib;s=open('withdrawn/021-position-analytics-truncates-pnl-bank-floors.md').read();print(hashlib.sha256(re.sub(r'## Evidence\\n.*?\\n\\n(?=## Environment)','',s,flags=re.S).encode()).hexdigest())"` |
| 021 repro | `withdrawn/021-repro.mts` (unchanged) | `sha256sum withdrawn/021-repro.mts` |
| 022-025 reports | `feedback/commitments/022-*.md` ... `025-*.md` (byte-exact originals; the live files differ only in the rewritten Environment section, plus one wording change in 023: "the 3 Hideki spot markets" became "the 3 spot markets on the Somnia Tokyo testnet (Hideki)") | `sha256sum feedback/commitments/02[2-5]-*.md` |
| 022-025 repros | `feedback/02[2-5]-repro.mts` (unchanged) | `sha256sum feedback/02[2-5]-repro.mts` |

To see exactly what changed in a report since it was committed: `diff feedback/commitments/<file> feedback/<file>`.

## Items 026-028 (committed 2026-10-21, not yet revealed)

Same rule as above: each line is the `sha256sum` of the exact file that will be published. Originals are kept byte-exact in `commitments/` (not pushed until submission).

```
ebf0308b660f23eea0a8697a031f02183b70572ad6b17f19673f8446c0bade68  item 026 report (.md)
24b392e76eaca35d90534dbccd6d416cedbaf8e5bb6f457b1d6783809128dcc5  item 026 repro script
58570bcbf966ccc351ccd0ca731f5d505d32cacf96bb94132291c6a29bbde10e  item 026 repro output (.txt)
f63622c62541b8351481dab5503f97aec83908db434d7b259db277f7b498ee5c  item 027 report (.md)
4091a00e8b311f30d4460b9317e91ceaeca823a27a72083b7c8e3620ef028367  item 027 repro script
f78c291793489eb39f1e18601b8783165ec7026e49de846413f7254ce2427a70  item 027 repro output (.txt)
b81b2e02fb1a40ad658ca4ff6e97b1c1f46abd21153339ab98c65990341beca8  item 028 report (.md)
188e7fe2ea55b52e70a3c8744a793201f7b9f8e3fc543e11cc818ef915c06b30  item 028 repro script
ac7b8036fc6ba73e7449083bc936503a4cf105d388dd8e4f7a1d7143556138dc  item 028 repro output (.txt)
```
