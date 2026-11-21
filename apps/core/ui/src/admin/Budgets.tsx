import { useEffect, useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import { token } from '@atlaskit/tokens';
import { errorText, isError } from '../bridge.js';
import type { ApiError, UsageDto } from '../types.js';
import { field } from '../panel/form-styles.js';
import { grid2, hint, h2, intIn, Labeled, PolicyForm, sectionStyle, usePolicySave, type PolicySectionProps } from './policy-editor.js';

const SAMPLES = [1, 3, 5] as const;

/** This month's use against the budget (and whether reviews are paused), and the caps themselves. */
export function Budgets(props: PolicySectionProps) {
  const id = useId();
  const { api, policy } = props;
  const [usage, setUsage] = useState<UsageDto | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [reviews, setReviews] = useState(String(policy.budget.reviewsPerMonth));
  const [tokensIn, setTokensIn] = useState(String(policy.budget.tokensInPerReview));
  const [tokensOut, setTokensOut] = useState(String(policy.budget.tokensOutPerReview));
  const [samples, setSamples] = useState<1 | 3 | 5>(policy.agentSamples);
  const [timeout, setTimeoutMin] = useState(String(policy.agentTimeoutMinutes));
  const s = usePolicySave(props);

  const loadUsage = () =>
    api
      .usage()
      .catch((): ApiError => ({ error: 'unavailable' }))
      .then((r) => (isError(r) ? setUsageError(errorText(r)) : setUsage(r)));
  useEffect(() => {
    void loadUsage();
  }, [api, policy]);

  const resume = async () => {
    const r = await api.resumeReviews().catch((): ApiError => ({ error: 'unavailable' }));
    if (isError(r)) return setUsageError(errorText(r));
    setUsageError(null);
    await loadUsage();
  };

  const submit = () => {
    const reviewsPerMonth = intIn(reviews, 1, 1_000_000);
    const tokensInPerReview = intIn(tokensIn, 1, 10_000_000);
    const tokensOutPerReview = intIn(tokensOut, 1, 10_000_000);
    const agentTimeoutMinutes = intIn(timeout, 1, 120);
    if (reviewsPerMonth === null) return s.fail('Reviews per month must be a whole number of at least 1.');
    if (tokensInPerReview === null || tokensOutPerReview === null) return s.fail('Token caps must be whole numbers of at least 1.');
    if (agentTimeoutMinutes === null) return s.fail('The agent timeout is 1 to 120 minutes.');
    void s.save({ budget: { reviewsPerMonth, tokensInPerReview, tokensOutPerReview }, agentSamples: samples, agentTimeoutMinutes });
  };

  const used = usage ? Math.min(1, usage.reviews / Math.max(1, usage.budget.reviewsPerMonth)) : 0;
  const paused = usage && (usage.paused.budget || usage.paused.credits);

  return (
    <section aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h2 id={`${id}-h`} style={h2}>
        Budgets
      </h2>
      {usageError && <p style={{ margin: 0 }}>{usageError}</p>}
      {usage && (
        <div style={{ display: 'grid', gap: 4 }}>
          <p style={{ margin: 0 }}>{`${usage.reviews} of ${usage.budget.reviewsPerMonth} reviews this month (${usage.month}), ${usage.agentSamples} agent runs.`}</p>
          <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: token('color.background.neutral'), overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(used * 100)}%`, height: '100%', borderRadius: 4, background: paused ? token('color.background.danger.bold') : token('color.background.brand.bold') }} />
          </div>
          {(usage.tokensIn > 0 || usage.tokensOut > 0) && <p style={hint}>{`Model tokens this month: ${usage.tokensIn.toLocaleString('en')} in, ${usage.tokensOut.toLocaleString('en')} out.`}</p>}
          <p role="status" style={{ margin: 0, color: paused ? token('color.text.danger') : token('color.text.subtle'), font: token('font.body.small') }}>
            {usage.paused.budget
              ? 'Reviews are paused: this month’s review budget is spent. Work stays blocked until a security champion confirms it, or you raise the budget.'
              : usage.paused.credits
                ? 'Reviews are paused: the last three agent runs came back empty, so the site may be out of Rovo credits. A security champion can confirm paused work.'
                : 'Reviews are running.'}
          </p>
          {usage.paused.credits && !usage.paused.budget && (
            <div>
              <Button onClick={() => void resume()}>Resume reviews</Button>
              <span style={{ ...hint, marginLeft: 8 }}>After topping up Rovo credits. The pause also lifts by itself 6 hours after the last agent run.</span>
            </div>
          )}
        </div>
      )}
      <p style={hint}>Each review asks the Rovo agent for this many independent threat models; more samples give steadier results and use more Rovo credits.</p>
      <PolicyForm label="Budgets" submitLabel="Save budgets" onSubmit={submit} {...s}>
        <div style={grid2}>
          <Labeled text="Reviews per month">{(fid) => <input id={fid} type="number" min={1} value={reviews} onChange={(e) => setReviews(e.target.value)} style={field} />}</Labeled>
          <Labeled text="Agent samples per review">
            {(fid) => (
              <select id={fid} value={samples} onChange={(e) => setSamples(Number(e.target.value) as 1 | 3 | 5)} style={field}>
                {SAMPLES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Labeled>
          <Labeled text="Agent timeout (minutes)">{(fid) => <input id={fid} type="number" min={1} max={120} value={timeout} onChange={(e) => setTimeoutMin(e.target.value)} style={field} />}</Labeled>
          <Labeled text="Input tokens per review">{(fid) => <input id={fid} type="number" min={1} value={tokensIn} onChange={(e) => setTokensIn(e.target.value)} style={field} />}</Labeled>
          <Labeled text="Output tokens per review">{(fid) => <input id={fid} type="number" min={1} value={tokensOut} onChange={(e) => setTokensOut(e.target.value)} style={field} />}</Labeled>
        </div>
        <span style={hint}>Token caps limit each Threatline Engine review (its Forge LLM calls are billed to the app's developer). Rovo agent reviews run on the site's Rovo credits.</span>
      </PolicyForm>
    </section>
  );
}
