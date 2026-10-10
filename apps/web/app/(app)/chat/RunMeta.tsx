import type { RunStepView, RunView } from "@kurisu/shared";

import {
  modelLabel,
  msLabel,
  runErrorLabel,
  secondsLabel,
  tokensLabel,
  toolsLabel,
} from "@/lib/runMeta";

/**
 * The run behind a reply, shown with it, never behind a tap (the design system's RunMeta):
 * "Model: Flash-Lite • 2.5s • 4 tools • 1,840 tok • progress-sync@17", with the tool calls
 * above it in a collapsed trace, and `report` (Report a problem) at the end of the line.
 */
export function RunMeta({ run, report }: { run: RunView; report?: React.ReactNode }) {
  const tools = run.steps.length;
  return (
    <>
      {tools > 0 && <Trace steps={run.steps} />}
      <div className="k-run">
        <span>
          Model: <b>{modelLabel(run.escalatedFrom ?? run.model)}</b>
          {run.escalatedFrom && <span className="k-run__esc"> → {modelLabel(run.model)}</span>}
          {run.handoff && (
            <>
              {" + "}
              <b>{modelLabel(run.handoff.model)}</b>
            </>
          )}
        </span>
        <span>{secondsLabel(run.latencyMs)}</span>
        <span>{toolsLabel(tools)}</span>
        <span>
          {run.error ? (
            <span className="k-run__err">{runErrorLabel(run.error)}</span>
          ) : (
            tokensLabel(run.inputTokens + run.outputTokens)
          )}
        </span>
        <span>
          {run.promptVersion}
          {run.handoff && ` + ${run.handoff.promptVersion}`}
        </span>
        {report}
      </div>
    </>
  );
}

/** "[+] 4 tool calls": each call's tool, what it was asked and returned, and how long it took. */
function Trace({ steps }: { steps: RunStepView[] }) {
  return (
    <details className="k-trace">
      <summary>
        {steps.length} tool call{steps.length === 1 ? "" : "s"}
      </summary>
      <ol>
        {steps.map((step, i) => {
          // A write that went through is the trace's one teal line.
          const tone = !step.ok ? " is-err" : step.tool === "commit_update" ? " is-ok" : "";
          return (
            <li key={i}>
              <span className="k-trace__tool">{step.tool}</span>
              <span className={`k-trace__out${tone}`} title={step.args}>
                {step.args ? `${step.args} → ` : ""}
                {step.result}
              </span>
              <span className="k-trace__ms">{msLabel(step.ms)}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
