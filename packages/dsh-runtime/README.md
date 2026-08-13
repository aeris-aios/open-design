# @open-design/dsh-runtime

Profile bundle that lets Open Design drive a user-installed DeepSeek Harness
through a strict JSONL stdio protocol. It does not ship the `dsh` executable,
Node.js, credentials, or provider configuration.

Install DeepSeek Harness first, then install this bundle into the
`open-design` profile:

```sh
dsh plugin --profile open-design add @open-design/dsh-runtime
dsh --profile open-design --probe
```

The probe prints exactly one JSON object. Open Design starts one short-lived
`dsh --profile open-design --stdio` process per run; Harness session storage
provides cold resume across later processes.
