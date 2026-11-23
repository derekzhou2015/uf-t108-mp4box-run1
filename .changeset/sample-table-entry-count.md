---
'mp4box': patch
---

Reject sample-table boxes whose declared entry/sample count does not match the
data the box actually carries, instead of growing arrays without bound and
exhausting memory with no error. The reconciliation covers the count-driven
sample-table boxes (stts, ctts, stsc, stss, stsh, stco, co64, stsz, stz2, padb,
saiz, sbgp, trun, subs) and fails fast through the existing `ERR_INVALID_DATA`
/ `onError` channel.
