// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import { requestJson } from '@/vitest/http';
import { listMessages } from '@/vitest/messages';
import { startRun, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

// OPEND-2367 / #7512 review: one inline question-form occurrence must yield one
// answer row and one run even when two submitters race — a second tab, or a
// reload in a context that denies storage, neither of which can see the other's
// form lock.
//
// The review's specific worry was that the row and the run could be won by
// different submitters, leaving a transcript that shows one answer while the
// only model run consumed the other. This drives that race at the daemon's HTTP
// boundary (the cheapest layer that can see it) rather than arguing about
// orderings: two concurrent POST /api/runs share a `clientRequestId` and a
// `userMessageId` — the identity `questionFormAnswerIdentity` derives from the
// occurrence — and carry DIFFERENT answers.
//
// The two answers are written so the fake agent behaves differently for each,
// so the finished run reports which prompt it actually consumed. Asserting that
// against the persisted row is what makes this a real check: a run that
// executed one answer while the transcript kept the other fails here.
//
// What the daemon actually does turns out to be stronger than reuse. The
// occupancy is a request fingerprint as well as an id, so the submitter whose
// answer differs is refused outright with 409 IDEMPOTENCY_CONFLICT — it never
// creates a run, and its row write was already refused by the create-only
// claim. There is therefore no ordering in which the surviving run and the
// stored answer can come apart.

type ProjectResponse = {
  conversationId: string;
  project: { id: string; name: string };
};

type RunStatusResponse = {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  endedWithUnfinishedWork?: boolean;
};

const ANSWER_PREFIX = '[form answers — travel_app_brief]';
// Distinguishable at the agent: only this one drives the unfinished-todo
// fixture, so the terminal run status reveals which answer the run consumed.
const ANSWER_UNFINISHED = `${ANSWER_PREFIX}\n- Audience: Designers\nEmit an unfinished-todo run`;
const ANSWER_PLAIN = `${ANSWER_PREFIX}\n- Audience: Founders`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('inline question form occurrence claim (OPEND-2367)', () => {
  test('two concurrent answers for one occurrence leave one row and one run that agree', async () => {
    const suite = await createSmokeSuite('question-form-occurrence-claim');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
        runtimeIds: ['claude'],
      });

      await requestJson(webUrl, '/api/app-config', {
        body: {
          agentCliEnv: { claude: fakeAgents.claude.env },
          agentId: 'claude',
          agentModels: { claude: { model: 'default', reasoning: 'default' } },
          designSystemId: null,
          onboardingCompleted: true,
          skillId: null,
          telemetry: { artifactManifest: true, content: false, metrics: false },
        },
        method: 'PUT',
      });

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'question-form-occurrence-claim',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      // The identity both submitters derive from the same occurrence.
      const occurrence = `qf-answer-${projectId.slice(0, 8)}`;
      const userMessageId = `${occurrence}-user`;

      const submit = (answer: string, tab: string) =>
        startRun(webUrl, {
          agentId: 'claude',
          // The assistant row is per-submitter; only the answer row and the run
          // are claimed on the occurrence.
          assistantMessageId: `${occurrence}-assistant-${tab}`,
          clientRequestId: occurrence,
          conversationId,
          designSystemId: null,
          message: answer,
          model: 'default',
          projectId,
          reasoning: 'default',
          skillId: null,
          userMessageId,
        });

      // Race them: neither awaits the other, exactly as two tabs would.
      const results = await Promise.allSettled([
        submit(ANSWER_UNFINISHED, 'a'),
        submit(ANSWER_PLAIN, 'b'),
      ]);
      const started = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');

      // Exactly one run exists, and the divergent submitter is told why rather
      // than quietly getting the other answer's run.
      expect(started).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(String((refused[0] as PromiseRejectedResult).reason)).toContain(
        'IDEMPOTENCY_CONFLICT',
      );
      const runId = (started[0] as PromiseFulfilledResult<{ runId: string }>).value.runId;

      await waitForRunTerminal(webUrl, runId, { timeoutMs: 20_000 });
      // The daemon finalizes the run onto its message asynchronously.
      await delay(200);

      const messages = await listMessages(webUrl, projectId, conversationId);
      const answers = messages.filter(
        (message) => message.role === 'user' && message.content.includes(ANSWER_PREFIX),
      );

      // One answer row, carrying the occurrence's id.
      expect(answers).toHaveLength(1);
      expect(answers[0]?.id).toBe(userMessageId);

      // And it is one of the two answers, not a merge of both.
      const storedAnswer = answers[0]?.content ?? '';
      expect([ANSWER_UNFINISHED, ANSWER_PLAIN]).toContain(storedAnswer);

      // The heart of it: the run executed the answer the transcript kept. Only
      // ANSWER_UNFINISHED drives the fake agent's unfinished-todo fixture, so
      // the terminal status tells us which prompt actually reached the agent.
      const status = await requestJson<RunStatusResponse>(
        webUrl,
        `/api/runs/${encodeURIComponent(runId)}`,
      );
      expect(status.endedWithUnfinishedWork ?? false).toBe(
        storedAnswer === ANSWER_UNFINISHED,
      );
    });
  }, 180_000);
});
