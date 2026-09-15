# Agent Harness: Runtime Specification

## Purpose

Build an agent runtime that can run independently in a TypeScript application and can also serve as a backend for `softov/ahpd`. Its job is to conduct a conversation with a model, offer tools, execute authorized tool calls, assemble context, manage the lifecycle of a turn, and expose what happens to its host. It is **not** an AHP implementation, a terminal client, or a wrapper around one model provider.

An agent definition supplies the instructions, model, tools, context strategy, hooks, and limits. A session owns conversation history across turns. A run executes one turn, potentially making several model requests and tool calls before it completes or pauses. The same runtime should work with an OpenRouter model, a local OpenAI-compatible endpoint, or a different model adapter without changing its control loop.

`ahpd` already has a host-facing `Agent` abstraction and an AHP session lifecycle. The new runtime should be wrapped in an adapter implementing those existing contracts. `ahpc` remains a client; it should see an ordinary AHP agent and need no runtime-specific logic.

## Vocabulary and boundaries

| Concept | Meaning | Owner |
| --- | --- | --- |
| Agent definition | Configuration and capabilities used to execute turns | Application |
| Model adapter | Converts normalized requests and replies to a provider API | Runtime extension |
| Session | Durable conversation identity and history | Runtime/store, mapped by host |
| Turn | One input and the work performed to answer it | Runtime |
| Model step | One inference request and response within a turn | Runtime |
| Tool call | A model's proposed invocation; the model never executes it | Runtime/tool executor |
| Hook | Application code allowed to inspect or change a planned operation | Runtime extension |
| Event | An immutable report of something that happened or a state transition | Runtime |
| Command | External input that affects a running or paused turn | Run controller |
| AHP adapter | Maps AHP sessions, actions, and approvals to runtime concepts | `ahpd` integration |

AHP describes communication between a host and clients. The harness describes execution behind the host. MCP can supply tools to the harness; neither AHP nor MCP should be the harness's internal message format.

## Public shape

The harness should expose an agent definition and a way to start or resume a run. Starting a run returns a **run handle** with a stable ID, current status, an ordered asynchronous stream of events, a way to submit commands, a way to cancel, and a final outcome. The host owns this handle for the life of the run. A client connection does not.

This is more useful than making a bare async generator the entire public API. A generator is a good way to implement sequential work, but feeding approvals through its `next(value)` ties control to the code consuming it. An AHP host may have several observers, a different client supplying the approval, or no connected clients. Commands need an independent path into the run.

Event delivery and command submission are separate directions:

| Direction | Examples | Rule |
| --- | --- | --- |
| Outbound events | Model started, text delta, tool proposed, approval requested, tool completed, turn finished | Ordered, identifiable, replayable where durable |
| Inbound commands | Approve, deny, answer, cancel | Validated against run state and request ID |
| Internal hooks | Change model request, deny tool, request approval, transform tool result | Executed by the runtime at defined boundaries |

The runtime may use `yield` internally to produce events. Its public event stream can be an `AsyncIterable`, backed by a queue or persisted log. The event's meaning does not depend on whether it was delivered by `yield`, a callback, or a subscription.

## Events versus hooks

`model.completed` is an **event**, because it states that a model request finished and records its reply. It is not normally a hook: an observer of that fact should not gain the authority to alter model behavior. A `beforeModel` hook is appropriate when code needs to alter or stop the request *before* it is sent. A `beforeTool` hook can authorize, deny, modify, or pause a proposed call before execution.

Specify each hook's timing, permitted changes, and failure behavior. Hooks that change an operation should return an explicit decision. Observational listeners should consume events instead of being mixed into intervention hooks. An `afterTool` transform may change what the model sees next, but the original outcome and the transformed value should remain distinguishable in the record.

Hooks are not automatically a security boundary. The runtime must enforce the final authorization decision immediately before executing a tool. A provider-specific hook that can be bypassed by another execution path cannot serve as the sole policy check.

## Turn lifecycle

1. Load the session and accept the user's input. Assign a run ID and append the input to the durable conversation record.
2. Assemble a bounded model request from instructions, history, current input, and any selected context. Run the pre-model intervention hook. Preserve the canonical history separately from this derived request.
3. Invoke the model adapter. Publish model progress and a completed reply. Record the reply, including the entire assistant message containing tool calls.
4. If there are no tool calls, finish the turn with a recorded outcome.
5. For each proposed tool call, locate the tool, parse and validate its arguments, apply policy and pre-tool hooks, then execute or report a denial/error as a tool result. A model-supplied tool name or JSON object is never trusted as authorization.
6. Append every tool result linked to its original call ID. Assemble context again and continue the model loop until it returns a final answer or a limit is reached.

Start with serial tool execution. Parallel calls require deliberate rules for conflicting writes, ordering, cancellation, and result publication; support them only when a use case justifies those rules. A step limit must terminate loops that repeatedly call tools or fail to produce a final answer.

Each turn ends in one explicit status: **completed**, **awaiting input or approval**, **stopped by policy or limit**, **cancelled**, or **failed**. Do not flatten these into a single “done” state. A paused turn needs a durable request ID, the proposed operation, the available decisions, and enough state to continue after process recovery.

## Model adapters

The model interface accepts normalized messages, tool definitions, model parameters, and a cancellation signal; it returns a normalized assistant reply, usage, and finish information. A Chat Completions adapter can initially cover OpenRouter and local servers such as LM Studio by changing endpoint, credentials, and model ID. Keep HTTP headers, provider response fields, retries, and error decoding inside the adapter.

The shared HTTP shape does **not** imply identical model capabilities. Adapters should report supported features, and configuration should say which model actually supports reliable tool calls, streaming, images, structured output, or other options. Reject an unsupported required feature instead of silently pretending it worked. Add a different adapter for APIs whose semantics cannot be represented faithfully by Chat Completions.

Streaming is a model-adapter concern first. It emits text and tool-call fragments; the runtime may publish safe text deltas immediately but must assemble each complete tool call before parsing, validating, approving, or executing it. A stream interruption must not leave a partial call that gets executed on retry.

## Tools and execution

A tool has a stable name, description, input schema, validator, executor, and effect metadata. Effect metadata describes whether it reads, writes, accesses the network, or has another significant effect. The advertised schema helps the model form arguments; runtime validation protects the executor. Validation must run again if a hook changes the arguments.

Tool execution receives a scoped context: session/run identity, permitted workspace or resources, cancellation signal, and relevant credentials provided by the host. Credentials belong to the executor or adapter and must not be inserted into model-visible messages. Tool results should be bounded in size and serialized into content the model can consume. Preserve structured error details internally even when the model receives a shorter error message.

MCP tools and application tools can both enter through a registry. The registry should normalize definitions and invocation, but it should not erase ownership: a host-run tool, an MCP server tool, and a client-owned AHP tool may have different execution and approval paths. The `ahpd` adapter must honor the existing `BoundTool` ownership semantics rather than running a client-owned tool in the host process.

## Context assembly

The session transcript is the source of truth. The context assembler builds a **view** of it for one model request. It can select recent turns, include relevant resources, summarize older material, and respect a model-specific token budget. It must keep assistant tool calls paired with their tool results and preserve the distinction between instructions, user input, retrieved material, and tool output.

Summaries should carry provenance and be replaceable or regenerable. Never overwrite the original transcript with a summary. The context assembler can evolve independently from the execution loop: start with instructions plus recent history and an explicit size limit; add retrieval, summarization, and caching when real sessions demand them.

## Persistence and recovery

Record inputs, assistant replies, tool calls and results, approval requests and decisions, run state transitions, and event sequence numbers. Persist state transitions before publishing them so a reconnecting observer can reconstruct a truthful state. Each event should include a session ID, run ID, sequence number, timestamp, and typed payload.

Recovery has a hard edge: a process can die after an external tool performed an action but before its result was recorded. The harness cannot guarantee exactly-once side effects for arbitrary tools. Tools that can support idempotency should receive a stable invocation ID; otherwise recovery should detect an uncertain invocation and require an explicit resolution rather than blindly repeat it.

Cancellation should propagate to the model request and running tool. A tool that cannot be cancelled may still finish; its outcome must be recorded honestly. Time, model-call, tool-call, output-size, and cost limits should be enforced by the runtime, not merely suggested in instructions.

## Integration with `ahpd`

Implement a backend using the existing `@ahpd/sdk` `Agent` and `Session` contracts. The backend advertises its models and settings, creates or resumes a runtime session, starts a run for each AHP turn, and maps runtime events into the AHP session/chat actions expected by the host. It translates AHP cancellation, approvals, answers, and host-contributed tools into runtime commands and tools.

The adapter must reconcile two identities: the AHP session/channel URI and the runtime's own durable session ID. It should retain both. Capabilities such as fork, rewind, multiple chats, and historical session listing should only be advertised when the runtime and its store actually implement them. AHP state and transcript shapes are protocol obligations of the adapter, not fields that the core runner must copy internally.

The same core can be run from a standalone CLI or another application with a different adapter. `ahpc` connects through AHP as it does today and should not import the harness.

## Build sequence and acceptance criteria

1. Define message, event, command, outcome, model, tool, and store contracts. Implement one non-streaming Chat Completions adapter and a deterministic fake model for tests.
2. Implement the bounded serial loop with argument validation, cancellation, and ordered events. Prove a model can request a tool, receive its result, and produce a final answer.
3. Add durable sessions and paused approvals. Prove that a run can pause, lose its observer, and resume from a command without executing the tool twice.
4. Implement the `ahpd` adapter. Verify with `ahpc` that a turn, tool approval, cancellation, reconnect, and history all display correctly.
5. Add streaming, context reduction, usage accounting, and more model adapters as separate increments. Test partial streamed calls and recovery after an uncertain tool invocation.

The first release is successful when one agent definition can run standalone against a local model or OpenRouter, and the same runtime can be hosted by `ahpd` without changing its model/tool loop. The AHP adapter may require substantial protocol mapping; that work should not leak into the standalone runtime.

## Reference points

- [`softov/ahpd`](https://github.com/softov/ahpd): existing host, SDK backend and session contracts.
- [`softov/ahpc`](https://github.com/softov/ahpc): existing AHP client behavior to validate the adapter.
- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling): tool-call request, response and follow-up pattern.
- [LM Studio tool use](https://lmstudio.ai/docs/developer/openai-compat/tools): local Chat Completions tool calls and streaming behavior.
- [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol): host/client session protocol.
