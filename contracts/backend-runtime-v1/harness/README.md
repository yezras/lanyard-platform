# Fake relay harness (`lp-k7g.11.1` / Brain RPC `lp-k7g.11.3`)

Local, offline harness that speaks **relay v1 NDJSON frames** without Portal
infrastructure. Backend conformance jobs use this to exercise:

1. **Hello validation** — gateway `hello` → connector `descriptor`
2. **Chat injection** — connector `inbound` MessageEvent frames
3. **Interrupt + Brain RPC** — `interrupt_inbound` and `brain_rpc_request` /
   `brain_rpc_result` correlation
4. **Required Brain RPC methods** — `FakeBrainRpcHost` implements the seven
   `contract.brain_rpc: 1` methods with vault path ACL (contributor vs admin)

Wire shapes mirror Portal `@lanyard/shared` relay types and Hermes
`relay-connector-contract.md` (`contract.relay: 1`). Brain RPC envelopes match
[`../brain-rpc.schema.json`](../brain-rpc.schema.json). Portal TypeScript
mirror: `portal/packages/backend-runtime` (`FakeBackendRuntimeService` /
`createFakeBrainRpcInvoker`).

## Layout

| File | Role |
| --- | --- |
| `frames.py` | Frame builders, NDJSON serialize/parse, `validate_hello_frame` |
| `descriptor.py` | `CapabilityDescriptor` for handshake reply |
| `mock_socket.py` | In-memory duplex (no ports / no `ws` library) |
| `harness.py` | `FakeRelayHarness` — connector / Portal-relay side |
| `fake_backend.py` | `FakeBackendClient` — gateway side for unit tests |
| `fake_brain_rpc.py` | `FakeBrainRpcHost` — required methods + vault ACL |
| `test_harness.py` | stdlib unittest suite (lp-k7g.11.1 acceptance) |
| `test_brain_rpc_required.py` | required-method + ACL conformance (lp-k7g.11.3) |
| `run_tests.py` | Offline entrypoint for harness unit tests |
| `run_brain_rpc_conformance.py` | Offline entrypoint for Brain RPC required methods |

## Quick start

```bash
# From repository root
python3 contracts/backend-runtime-v1/harness/run_tests.py
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
python3 scripts/run-hermes-lanyard-conformance.py   # lp-k7g.11.4 offline job

# Or via monorepo gate
bash scripts/validate.sh   # checks 18 + 20 + 21
```

## Usage sketch

```python
from harness.mock_socket import MockSocket
from harness.harness import FakeRelayHarness
from harness.fake_backend import FakeBackendClient
from harness.fake_brain_rpc import FakeBrainRpcHost

relay_sock, gateway_sock = MockSocket.create_pair()
host = FakeBrainRpcHost()
harness = FakeRelayHarness(relay_sock)
backend = FakeBackendClient(gateway_sock, brain_rpc=host)

backend.connect_hello()
harness.accept_hello()          # validates hello, sends descriptor
backend.await_descriptor()

harness.inject_chat("hello brain", chat_id="chat-1")
harness.send_interrupt("agent:main:lanyard_web:dm:chat-1", "chat-1")
harness.send_brain_rpc(
    "brain.ping",
    request_id="req_1",
    params={"echo": "hi"},
    backend_profile="contributor",
    path_prefixes=["/Projects"],
)
backend.poll()                  # auto-dispatch via FakeBrainRpcHost
print(harness.wait_brain_rpc_result("req_1"))
```

## Direction cheat-sheet

| Direction | Frames |
| --- | --- |
| Gateway → harness (connector) | `hello`, `outbound`, `interrupt`, `going_idle`, `inbound_ack`, `brain_rpc_result` |
| Harness → gateway | `descriptor`, `inbound`, `outbound_result`, `interrupt_inbound`, `going_idle_ack`, `brain_rpc_request` |

## Non-goals

- Live WebSocket listener / auth (upgrade tokens, jti) — later conformance jobs
- Full Portal chat hub, SSE, or multi-relay bus
- Replacing schema validators in `scripts/validate-brain-rpc.py`

## Hermes-Lanyard artifact job (`lp-k7g.11.4`)

The harness is the fake-relay half of the product conformance job:

```bash
# Offline: fixture + pins.example.yaml + this harness (FakeBrainRpcHost path)
python3 scripts/run-hermes-lanyard-conformance.py --mode offline
# also: bash scripts/validate.sh  (check 21)
```

Download mode (real pinned tarball from S3/HTTPS) is documented in the job
script and the draft workflow `.github/workflows/conformance.yml`. Brain RPC
still runs over the in-process reference host until a live gateway adapter
lands.

## Related

- [`../conformance.md`](../conformance.md) — suite expectations + matrix
- Phase 7 plan: `docs/plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md`
- Job entrypoint: `scripts/run-hermes-lanyard-conformance.py`
- Portal reference (external tree): `portal/packages/relay`, `portal/packages/shared/src/relay/`
