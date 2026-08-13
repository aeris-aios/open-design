# @open-design/dsh-runtime

Profile bundle that lets Open Design drive a user-installed DeepSeek Harness
through a strict JSONL stdio protocol. It does not ship the `dsh` executable,
Node.js, credentials, or provider configuration.

Install DeepSeek Harness first. After this package is published, install the
exact version supported by your Open Design build into the `open-design`
profile (do not use an unbounded `latest` range):

```sh
dsh plugin --profile open-design add @open-design/dsh-runtime@0.1.0
dsh --profile open-design --probe
```

For repository development before publication, run this package's build and
`npm pack`, then pass the resulting tarball path to the same `dsh plugin`
command. Open Design does not silently install or update the profile in phase
one.

The probe prints exactly one JSON object. Open Design starts one short-lived
`dsh --profile open-design --stdio` process per run; Harness session storage
provides cold resume across later processes.
