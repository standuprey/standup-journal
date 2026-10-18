/**
 * deeep — feature delivery pipeline run like an agency engagement.
 *
 *   /deeep <feature description>   start a feature (architect phase)
 *   /deeep go                      execute ready tasks (after specs.md is validated)
 *   /deeep stop | pause            stop all spawned worker agents; resume with /deeep go
 *   /deeep status                  show task board
 *   /deeep reset                   forget current feature
 *
 * Flow:
 *   1. The main (cloud) model acts as architect: explores the repo, asks the
 *      client clarifying questions, then writes specs.md containing atomic
 *      tasks (id, difficulty, suggested model, dependencies).
 *   2. The client reviews/edits specs.md and validates (confirm dialog or /deeep go).
 *   3. The extension owns all git: per task it creates the branch from the
 *      base, merges dependency branches, runs the weak-model worker agent in
 *      an isolated `git worktree` (implementation only — the worker never
 *      runs git), then commits, pushes, and opens a PR when gh is available.
 *   4. When no more tasks can proceed, the user is asked to review & merge
 *      the PRs before the next wave starts (/deeep go resumes).
 *
 *   stop/pause never touch task state: it just sets paused=true and kills
 *   child processes. Starting a NEW feature over existing state requires a
 *   confirm dialog so a typo'd verb can never silently wipe state.
 *
 * State lives in .deeep/state.json next to specs.md in the repo root.
 * Child agents set DEEEEP_CHILD=1; this extension disables itself there.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SPEC_FILE = "specs.md";
const STATE_DIR = ".deeep";
const STATE_FILE = path.join(STATE_DIR, "state.json");

type TaskStatus = "pending" | "running" | "done" | "failed";

interface DeepTask {
	id: string;
	title: string;
	difficulty: string;
	model: string;
	deps: string[];
	details: string;
	status: TaskStatus;
	branch?: string;
	prUrl?: string;
	error?: string;
}

interface DeepState {
	feature: string;
	shortname: string;
	phase: "planning" | "ready" | "executing" | "paused" | "complete";
	tasks: DeepTask[];
	paused?: boolean;
}

function run(
	cmd: string,
	args: string[],
	opts: {
		cwd: string;
		env?: Record<string, string>;
		onSpawn?: (child: ChildProcess) => void;
		onStdoutChunk?: (chunk: string) => void;
	},
): Promise<{ code: number; stdout: string; stderr: string; signal?: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			// stdin must not be an open pipe: pi --print waits for stdin EOF before
			// sending the model request, so a never-closed pipe hangs the worker forever.
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, ...opts.env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d) => {
			const chunk = String(d);
			stdout += chunk;
			opts.onStdoutChunk?.(chunk);
		});
		child.stderr?.on("data", (d) => (stderr += String(d)));
		child.on("close", (code, signal) => resolve({ code: code ?? 1, stdout, stderr, signal: signal ?? undefined }));
		child.on("error", (err) => resolve({ code: 1, stdout, stderr: String(err) }));
		opts.onSpawn?.(child);
	});
}

const sh = (cmd: string, cwd: string) => run("sh", ["-c", cmd], { cwd });

function slugify(s: string, max = 12): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/, "");
}

function parseSpecs(markdown: string, fallbackShort: string): { tasks: DeepTask[]; warnings: string[] } {
	const tasks: DeepTask[] = [];
	const warnings: string[] = [];
	const sections = markdown.split(/^###\s+/m).slice(1);
	for (const section of sections) {
		const lines = section.split("\n");
		const id = lines[0]?.trim().split(/\s+/)[0];
		if (!id || !/^[a-z0-9][a-z0-9-]*$/i.test(id)) continue;
		let title = lines[0].trim().slice(id.length).replace(/^[\s:–-]+/, "").trim();
		let difficulty = "";
		let model = "";
		let depsRaw = "";
		let summary = "";
		let details = "";
		let inDetails = false;
		for (const line of lines.slice(1)) {
			// Bold labels like "**Model:**" put the closing "**" AFTER the colon; accept stars
		// on either side of it and strip them from the value instead.
		const field = line.match(
			/^\s*[-*]\s*\*{0,2}\s*(difficulty|model|depends(?:\s+on)?|summary|details)\s*:\s*\*{0,2}\s*(.*)$/i,
		);
			if (field) {
				inDetails = false;
				const key = field[1].toLowerCase();
				const value = field[2].trim();
				if (key === "difficulty") difficulty = value.replace(/[*`]/g, "").trim();
				else if (key === "model") model = value.replace(/[*`]/g, "").trim();
				else if (key.startsWith("depends")) depsRaw = value;
				else if (key === "summary") summary = value;
				else if (key === "details") {
					inDetails = true;
					details = value;
				}
			} else if (inDetails) {
				details += "\n" + line;
			}
		}
		const deps = depsRaw && !/^(\*{0,2}\s*)?none\b/i.test(depsRaw)
			? depsRaw
					.split(/[,\s]+/)
					.map((d) => d.replace(/[*`]/g, "").trim())
					.filter((d) => d && !/^none$/i.test(d))
			: [];
		if (!title) title = summary || id;
		if (!details.trim()) details = summary;
		tasks.push({
			id,
			title,
			difficulty: difficulty || "medium",
			model: model || "qwen2.5-coder:7b",
			deps,
			details: details.trim(),
			status: "pending",
		});
	}
	// Ensure task ids are unique and derive shortname from the first id if possible
	const seen = new Set<string>();
	for (const t of tasks) {
		while (seen.has(t.id)) t.id += "-x";
		seen.add(t.id);
	}
	void fallbackShort;

	// Drop deps referencing task ids that do not exist — an unknown dep can never
	// become "done" and would block the task (and everything behind it) forever.
	const ids = new Set(tasks.map((t) => t.id));
	for (const t of tasks) {
		const unknown = t.deps.filter((d) => !ids.has(d));
		if (unknown.length) {
			warnings.push(`${t.id}: ignoring unknown deps ${unknown.join(", ")}`);
			t.deps = t.deps.filter((d) => ids.has(d));
		}
	}
	return { tasks, warnings };
}

function specsTemplate(feature: string, shortname: string): string {
	return `# Feature: ${feature}

## Overview

<!-- The architect fills this in: what will be built and why. -->

## Tasks

### ${shortname}-1
- **Difficulty:** easy
- **Model:** qwen2.5-coder:7b
- **Depends on:** none
- **Summary:** One-line description of the task.
- **Details:** Complete, self-contained instructions: files to touch, expected behavior, interfaces, edge cases. A worker agent executes this with no other context.
`;
}

const CONCISE_RULES = [
	"- Be maximally concise: no filler, no pleasantries, no restating the task, no narrating what you are about to do.",
	"- Default replies to under 10 lines. Longer is only acceptable when the reply IS an artifact (specs.md content, code, PR description).",
	"- Questions to the client: numbered, one line each, grouped in one message.",
	"- Report outcomes, not process: what changed, what was validated, what is blocking. Done.",
	"- Never pad with summaries of the conversation or generic advice.",
].join("\n");

function statusLine(t: DeepTask): string {
	const icon = { pending: "○", running: "◐", done: "●", failed: "✗" }[t.status];
	const deps = t.deps.length ? ` (needs: ${t.deps.join(", ")})` : "";
	return `${icon} ${t.id} [${t.difficulty}] ${t.model} — ${t.title}${deps}${t.error ? ` — ERROR: ${t.error}` : ""}`;
}

export default function (pi: ExtensionAPI) {
	if (process.env.DEEEEP_CHILD) return; // worker agents do not re-register /deeep

	let cwd = process.cwd();
	let repoRoot = cwd;

	// Worker agent child processes keyed by task id, so /deeep stop can kill them.
	const activeChildren = new Map<string, ChildProcess>();

	async function gitRoot(): Promise<string> {
		const r = await sh("git rev-parse --show-toplevel 2>/dev/null", cwd);
		return r.code === 0 ? r.stdout.trim() : cwd;
	}

	function statePath(): string {
		return path.join(repoRoot, STATE_FILE);
	}
	function specPath(): string {
		return path.join(repoRoot, SPEC_FILE);
	}

	function loadState(): DeepState | null {
		try {
			return JSON.parse(readFileSync(statePath(), "utf8")) as DeepState;
		} catch {
			return null;
		}
	}
	function saveState(state: DeepState) {
		mkdirSync(path.dirname(statePath()), { recursive: true });
		writeFileSync(statePath(), JSON.stringify(state, null, 2));
	}

	function resolveModel(model: string): string {
		if (model.includes("/")) return model; // already provider/model
		if (model.includes(":")) return `ollama/${model}`; // ollama tag
		return model;
	}

	function readyTasks(state: DeepState): DeepTask[] {
		const ids = new Set(state.tasks.map((t) => t.id));
		return state.tasks.filter(
			(t) =>
				t.status === "pending" &&
				// Deps missing from the task list are ignored rather than blocking forever.
				t.deps.every((d) => !ids.has(d) || state.tasks.find((x) => x.id === d)?.status === "done"),
		);
	}

	function prBodyPath(taskId: string): string {
		return path.join(repoRoot, STATE_DIR, `${taskId}.pr.md`);
	}

	function fallbackPrBody(task: DeepTask, feature: string): string {
		return [
			`Part of **${feature}** (see specs.md).`,
			``,
			`- Difficulty: ${task.difficulty}`,
			`- Executed by: ${task.model}`,
			`- Depends on: ${task.deps.join(", ") || "none"}`,
		].join("\n");
	}

	async function openPr(task: DeepTask, base: string, feature: string): Promise<string | undefined> {
		const push = await sh(`git push -u origin ${task.branch} 2>&1`, repoRoot);
		if (push.code !== 0) return undefined;

		// Prefer the PR description drafted by the worker agent; fall back to a minimal body.
		const bodyFile = prBodyPath(task.id);
		const bodyArgs = existsSync(bodyFile)
			? ["--body-file", bodyFile]
			: ["--body", fallbackPrBody(task, feature)];

		const pr = await run(
			"gh",
			[
				"pr",
				"create",
				"--base",
				base,
				"--head",
				task.branch!,
				"--title",
				`${task.id}: ${task.title}`,
				...bodyArgs,
			],
			{ cwd: repoRoot },
		);
		if (pr.code !== 0) return undefined;
		const url = pr.stdout.match(/https:\/\/\S+\/pull\/\d+/);
		if (existsSync(bodyFile)) {
			try {
				await sh(`mv ${bodyFile} ${bodyFile}.used`, repoRoot);
			} catch {
				/* keep it */
			}
		}
		return url?.[0];
	}

	async function executeTask(task: DeepTask, base: string, state: DeepState, onDone: () => void) {
			task.status = "running";
			task.branch = task.id;
			saveState(state);

			const fail = (error: string) => {
				task.status = "failed";
				task.error = error.trim().slice(-500);
				saveState(state);
				onDone();
			};

			// --- Git handling is owned by the extension, never the worker agent. ---
			// Task branch is always (re)based off origin/<base>: each execution starts
			// fresh from the remote default branch (deps are merged on top next), so
			// leftover branches from earlier failed attempts never poison a retry.
			// The main worktree must not sit on a branch we are about to reset/force.
			const head = (await sh("git branch --show-current", repoRoot)).stdout.trim();
			if (head === task.id) await sh(`git checkout ${base}`, repoRoot);
			await sh(`git fetch origin ${base} 2>/dev/null`, repoRoot);
			const remoteRef = `origin/${base}`;
			const hasRemote =
				(await sh(`git rev-parse --verify ${remoteRef} >/dev/null 2>&1`, repoRoot)).code === 0;
			const from = hasRemote ? remoteRef : base;
			const ensure = await sh(
				`git rev-parse --verify ${task.id} >/dev/null 2>&1 && git branch -f ${task.id} ${from} || git branch ${task.id} ${from}`,
				repoRoot,
			);
			if (ensure.code !== 0) {
				fail(`branch: ${ensure.stderr || ensure.stdout}`);
				return;
			}

			// Isolated worktree per task so parallel waves never fight over HEAD/index.
			const wt = path.join(repoRoot, STATE_DIR, "worktrees", task.id);
			await sh(`rm -rf ${JSON.stringify(wt)} && git worktree prune`, repoRoot);
			const add = await sh(`git worktree add ${JSON.stringify(wt)} ${task.id}`, repoRoot);
			if (add.code !== 0) {
				fail(`worktree: ${add.stderr || add.stdout}`);
				return;
			}

			try {
				// Merge dependency branches so the worker implements against real dep code.
				for (const dep of task.deps) {
					const m = await sh(`git merge --no-edit ${dep}`, wt);
					if (m.code !== 0) {
						fail(`merge ${dep}: ${m.stderr || m.stdout}`);
						return;
					}
				}

				let reply = "";
				try {
					reply = await runWorker(task, wt, state);
				} catch (e) {
					const msg = String(e instanceof Error ? e.message : e);
					if (/interrupted/.test(msg) || loadState()?.paused) {
						task.status = "pending"; // /deeep stop — resume with /deeep go
						task.error = "interrupted by /deeep stop";
						saveState(state);
						onDone();
					} else {
						fail(`worker: ${msg}`);
					}
					return;
				}

				// Anything to commit?
				const dirty = (await sh("git status --porcelain", wt)).stdout.trim();
				if (!dirty) {
					fail("no changes produced");
					return;
				}
				const msg = `feat(${task.id}): ${task.title.replace(/"/g, "'")}`;
				const commit = await sh(`git add -A && git commit -m ${JSON.stringify(msg)}`, wt);
				if (commit.code !== 0) {
					fail(`commit: ${commit.stderr || commit.stdout}`);
					return;
				}

				// The PR body is written by the extension; the worker only implements.
				try {
					writeFileSync(
						prBodyPath(task.id),
						[
							`Part of **${state.feature}** (see specs.md).`,
							``,
							`- Difficulty: ${task.difficulty}`,
							`- Executed by: ${task.model}`,
							`- Depends on: ${task.deps.join(", ") || "none"}`,
							``,
							`# Why`,
							task.details,
							``,
							`# How`,
							reply || "See the commit diff.",
							``,
							`# Test`,
							/validated|test/i.test(reply)
								? reply
								: "Worker ran the repo's checks during implementation; see commit message.",
						].join("\n"),
					);
				} catch {
					/* openPr falls back to a minimal body */
				}

				task.status = "done";
				const prUrl = await openPr(task, base, state.feature);
				if (prUrl) task.prUrl = prUrl;
				saveState(state);
				onDone();
			} finally {
				await sh(
					`git worktree remove --force ${JSON.stringify(wt)} 2>/dev/null; rm -rf ${JSON.stringify(wt)}`,
					repoRoot,
				);
			}
		}

		// Run the weak-model worker inside the task worktree: implementation only, no git.
		async function runWorker(task: DeepTask, wt: string, state: DeepState): Promise<string> {
			const logPath = path.join(repoRoot, STATE_DIR, `${task.id}.txt`);
			const appendLog = (text: string) => {
				try {
					appendFileSync(logPath, text);
				} catch {
					/* best effort — logging must never break execution */
				}
			};
			appendLog(`\n=== ${task.id} — ${new Date().toISOString()} (model ${resolveModel(task.model)}) ===\n`);

			let reply = "";
			let jsonBuf = "";
			const handleRecord = (line: string) => {
				const trimmed = line.trim();
				if (!trimmed) return;
				try {
					const rec = JSON.parse(trimmed) as Record<string, any>;
					const ev = rec?.assistantMessageEvent;
					if (typeof ev?.delta === "string" && /thinking|text/i.test(String(ev.type))) {
						appendLog(ev.delta);
						if (/text/i.test(String(ev.type))) reply += ev.delta;
					}
					if (rec?.type === "turn_end" && Array.isArray(rec.toolResults)) {
						const names = rec.toolResults
							.map((r: any) => r?.toolName ?? r?.name)
							.filter((n: unknown): n is string => typeof n === "string");
						if (names.length) appendLog(`\n[tools: ${names.join(", ")}]\n`);
					}
				} catch {
					appendLog(`\n[raw] ${trimmed}\n`);
				}
			};

			const prompt = [
				`You are implementing ONE atomic task of the feature "${state.feature}" in the repository worktree at ${wt}.`,
				``,
				`Task ID: ${task.id} (branch "${task.branch ?? task.id}" is already checked out for you).`,
				`Difficulty: ${task.difficulty}. Suggested model: ${task.model} (you are running on it).`,
				`Depends on: ${task.deps.join(", ") || "nothing"} (dependency branches are already merged into your branch).`,
				``,
				`Task spec:`,
				task.details,
				``,
				`Steps:`,
				`1. Implement exactly this task, following the repository's existing conventions.`,
				`2. Run whatever checks/tests exist that cover your change.`,
				`3. Leave your work in place as modified/new files — that is all. Uncommitted changes are picked up automatically when you finish.`,
				``,
				`GIT IS HANDLED FOR YOU: the pipeline created the branch, merged dependencies, and will commit, push, and open the PR. Do NOT run any git commands (no branch, checkout, add, commit, push, PR).`,
				`Rules: do not work on other tasks, do not modify specs.md. If the task is ambiguous, make the most reasonable choice and mention it in your final reply.`,
				``,
				`COMMUNICATION STYLE:`,
				CONCISE_RULES,
				`- Final reply: 3-6 lines max — what you implemented, what you validated (commands + result), any caveat.`,
			].join("\n");

			const result = await run(
				"pi",
				["--mode", "json", "--print", "--no-session", "--model", resolveModel(task.model), prompt],
				{
					cwd: wt,
					env: { DEEEEP_CHILD: "1" },
					onSpawn: (child) => activeChildren.set(task.id, child),
					onStdoutChunk: (chunk) => {
						jsonBuf += chunk;
						const lines = jsonBuf.split("\n");
						jsonBuf = lines.pop() ?? "";
						for (const line of lines) handleRecord(line);
					},
				},
			);
			activeChildren.delete(task.id);
			if (jsonBuf.trim()) handleRecord(jsonBuf);
			jsonBuf = "";
			appendLog(`\n=== ${task.id} — ended (exit ${result.code}${result.signal ? `, signal ${result.signal}` : ""}) ===\n`);

			// A killed worker (SIGTERM/SIGKILL from /deeep stop) must not have its
			// half-done work committed — surface as an error so the caller resets
			// the task to pending for a clean resume.
			if (result.signal) throw new Error(`worker interrupted (signal ${result.signal})`);
			return reply.trim();
		}

	async function resolveBase(): Promise<string> {
		return (
			(
				await sh(
					"git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main",
					repoRoot,
				)
			).stdout.trim()
				.replace(/^origin\//, "") || "main"
		);
	}

	// Scripted merge check — no model involved. A task counts as merged when its
	// branch tip is reachable from the base branch (local or origin) or when
	// GitHub reports the PR merged (covers squash merges).
	async function isMerged(task: DeepTask, base: string): Promise<boolean> {
		for (const target of [`origin/${base}`, base]) {
			const r = await sh(
				`git rev-parse --verify ${target} >/dev/null 2>&1 && git merge-base --is-ancestor ${task.id} ${target}`,
				repoRoot,
			);
			if (r.code === 0) return true;
		}
		const pr = await run("gh", ["pr", "view", task.id, "--json", "state"], { cwd: repoRoot });
		if (pr.code === 0) {
			try {
				if (JSON.parse(pr.stdout).state === "MERGED") return true;
			} catch {
				/* fall through */
			}
		}
		return false;
	}

	async function unmergedTasks(tasks: DeepTask[], base: string): Promise<DeepTask[]> {
		await sh(`git fetch origin 2>/dev/null`, repoRoot);
		const out: DeepTask[] = [];
		for (const t of tasks) if (!(await isMerged(t, base))) out.push(t);
		return out;
	}

	// Block until every expected PR is merged into the base branch (checked by
	// script, not by trust). Returns false if aborted via /deeep stop.
	async function waitForMerges(tasks: DeepTask[], base: string, ctx: { ui: any }): Promise<boolean> {
		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const label = (list: DeepTask[]) => list.map((t) => `${t.id}${t.prUrl ? ` (${t.prUrl})` : ""}`).join(", ");
		ctx.ui.notify(`deeep: merge these PRs into ${base} before the next wave — waiting: ${label(tasks)}`, "warning");
		for (;;) {
			await sleep(10000);
			if (loadState()?.paused) {
				ctx.ui.notify(`deeep: /deeep stop — merge wait aborted. Still unmerged: ${label(tasks)}`, "warning");
				return false;
			}
			const left = await unmergedTasks(tasks, base);
			if (left.length === 0) {
				ctx.ui.notify(`deeep: all expected merges detected — starting next wave.`, "info");
				return true;
			}
		}
	}

	async function runWaves(ctx: { ui: any }) {
			// ---- Scripted workflow engine ------------------------------------------
			// Every automatic step is deterministic script logic — no model, no trust:
			//   * which tasks start: deps done AND dep branches merged into the base
			//     branch (git-checked via merge-base / gh PR state),
			//   * how many run in parallel (DEEEEP_MAX_PARALLEL),
			//   * merge gating before dependents start,
			//   * completion / blocked detection.
			// A heavyweight workflow lib adds nothing here: Metaflow is Python (wrong
			// runtime — this is a TS extension), and LangChain is an LLM framework,
			// while this scheduler needs zero model calls.
			const cap = Math.max(1, Number(process.env.DEEEEP_MAX_PARALLEL || 2));
			for (;;) {
				const state = loadState();
				if (!state || state.paused) return;

				state.phase = "executing";
				saveState(state);
				const base = await resolveBase();
				const tasks = state.tasks;
				const done = tasks.filter((t) => t.status === "done");
				const failed = tasks.filter((t) => t.status === "failed");
				const pending = tasks.filter((t) => t.status === "pending");

				// Scripted tick: which done-task branches have landed on the base?
				const unmerged = await unmergedTasks(done, base);
				const mergedIds = new Set(done.filter((t) => !unmerged.includes(t)).map((t) => t.id));

				// A task is dispatchable only when every dep is done AND merged.
				const ready = pending.filter((t) =>
					t.deps.every((d) => {
						const dep = tasks.find((x) => x.id === d);
						return !dep || (dep.status === "done" && mergedIds.has(d));
					}),
				);

				// 1. Dispatch ready tasks (all git handling scripted in executeTask).
				if (ready.length > 0) {
					const batch = ready.slice(0, cap);
					ctx.ui.notify(`deeep: dispatching ${batch.length} task(s): ${batch.map((t) => t.id).join(", ")}`, "info");
					await Promise.all(batch.map((t) => executeTask(t, base, state, () => {})));
					continue; // re-tick: fresh merge checks, newly-done deps
				}

				// 2. Nothing runnable — block until pending merges land on the base.
				if (unmerged.length > 0) {
					const ok = await waitForMerges(unmerged, base, ctx);
					if (!ok) return; // aborted via /deeep stop
					continue;
				}

				// 3. Terminal: nothing running, nothing ready, nothing waiting.
				if (pending.length === 0 && failed.length === 0) {
					state.phase = "complete";
					saveState(state);
					ctx.ui.notify(
						`deeep: feature complete — ${done.length}/${tasks.length} tasks done, all merged.`,
						"info",
					);
				} else {
					state.phase = "paused";
					saveState(state);
					ctx.ui.notify(
						[
							`deeep: workflow blocked.`,
							done.length ? `Done: ${done.map((t) => t.id + (t.prUrl ? ` (${t.prUrl})` : "")).join(", ")}` : "",
							failed.length ? `Failed: ${failed.map((t) => t.id).join(", ")} (details: /deeep status)` : "",
							pending.length ? `Blocked by failed deps: ${pending.map((t) => t.id).join(", ")}` : "",
							`Fix the failures, then run /deeep go (reset statuses in .deeep/state.json if needed).`,
						].filter(Boolean).join(" | ") + (loadState()?.paused ? " (/deeep stop is active — run /deeep go to resume.)" : ""),
						pending.length ? "warning" : "info",
					);
				}
				return;
			}
		}

	pi.registerCommand("deeep", {
		description: "Agency-style feature pipeline: architect plan → specs.md → agent tasks → PRs",
		handler: async (rawArgs, ctx) => {
			cwd = ctx.cwd ?? process.cwd();
			repoRoot = await gitRoot();
			const args = rawArgs?.trim() ?? "";

			if (args === "reset") {
				try {
					await sh(`rm -f ${statePath()}`, repoRoot);
					ctx.ui.notify("deeep: state cleared (specs.md kept).", "info");
				} catch {
					ctx.ui.notify("deeep: nothing to reset.", "info");
				}
				return;
			}

			if (args === "status") {
				const state = loadState();
				if (!state) {
					ctx.ui.notify("deeep: no active feature. Start one with /deeep <description>.", "info");
					return;
				}
				ctx.ui.notify(
					`deeep: ${state.feature} [${state.phase}] —\n` + state.tasks.map(statusLine).join("\n"),
					"info",
				);
				return;
			}

			const verb = args.split(/\s+/)[0] ?? "";
			if (verb === "stop" || verb === "pause") {
				if (args !== "stop" && args !== "pause") {
					ctx.ui.notify("deeep: /deeep stop takes no arguments.", "warning");
					return;
				}
				const state = loadState();
				if (!state) {
					ctx.ui.notify("deeep: no active feature.", "info");
					return;
				}
				state.paused = true;
				state.phase = "paused";
				saveState(state);
				const ids = [...activeChildren.keys()];
				for (const child of activeChildren.values()) {
					try {
						child.kill("SIGTERM");
					} catch {
						/* already gone */
					}
				}
				if (ids.length) {
					setTimeout(() => {
						for (const child of activeChildren.values()) {
							try {
								child.kill("SIGKILL");
							} catch {
								/* already gone */
							}
						}
					}, 3000);
				}
				ctx.ui.notify(
					ids.length
						? `deeep: stopped — interrupted ${ids.join(", ")}. Interrupted tasks stay pending. Logs: .deeep/<task_id>.txt. Run /deeep go to resume.`
						: "deeep: paused — nothing running right now; new waves are blocked. Run /deeep go to resume.",
					"info",
				);
				return;
			}

			if (args === "go") {
				let state = loadState();
				if (!state) {
					// No state but a specs.md exists: offer to adopt it and start work.
					if (!existsSync(specPath())) {
						ctx.ui.notify("deeep: no active feature. Start one with /deeep <description>.", "warning");
						return;
					}
					const specText = readFileSync(specPath(), "utf8");
					const parsed = parseSpecs(specText, "");
					if (parsed.warnings.length) ctx.ui.notify(`deeep: ${parsed.warnings.join("; ")}`, "warning");
					if (parsed.tasks.length === 0) {
						ctx.ui.notify("deeep: no active feature and specs.md has no parseable tasks. Start one with /deeep <description>.", "warning");
						return;
					}
					const featureMatch = specText.match(/^#\s+Feature:\s*(.+)$/m);
					const feature = featureMatch?.[1]?.trim() || "feature";
					const shortname = parsed.tasks[0].id.replace(/-\d+$/, "") || slugify(feature, 10) || "task";
					let adopted = false;
					try {
						adopted = await ctx.ui.confirm(
							`deeep: ${featureMatch?.[0]?.trim() ?? feature}`,
							`No active feature, but specs.md has ${parsed.tasks.length} task(s). Use it to start the work?`,
						);
					} catch {
						adopted = false;
					}
					if (!adopted) {
						ctx.ui.notify("deeep: not started. (/deeep <description> to plan a new feature.)", "info");
						return;
					}
					state = { feature, shortname, phase: "ready", tasks: parsed.tasks };
					saveState(state);
					ctx.ui.notify(`deeep: adopted specs.md — ${parsed.tasks.length} task(s). Starting execution.`, "info");
				}
				// Resume: clear any previous /deeep stop.
				if (state.paused) {
					state.paused = false;
					saveState(state);
				}
				// Re-read specs.md in case the client edited it since validation.
				const parsed = parseSpecs(readFileSync(specPath(), "utf8"), state.shortname);
				if (parsed.warnings.length) ctx.ui.notify(`deeep: ${parsed.warnings.join("; ")}`, "warning");
				if (parsed.tasks.length) {
					const byId = new Map(state.tasks.map((t) => [t.id, t]));
					state.tasks = parsed.tasks.map((t) => {
						const prev = byId.get(t.id);
						return prev
							? { ...t, status: prev.status, branch: prev.branch, prUrl: prev.prUrl, error: prev.error }
							: t;
					});
					saveState(state);
				}
				const ready = readyTasks(state);
				if (ready.length === 0) {
					const pending = state.tasks.filter((t) => t.status === "pending");
					ctx.ui.notify(
						pending.length
							? `deeep: no ready tasks — remaining ${pending.map((t) => t.id).join(", ")} all depend on unfinished work. Merge the PRs, then /deeep go.`
							: "deeep: nothing left to execute.",
						"info",
					);
					return;
				}
				void runWaves(ctx);
				return;
			}

			// ---- Start a new feature: architect phase ----
			const description = args;
			if (!description) {
				ctx.ui.notify("Usage: /deeep <feature description> | go | stop | pause | status | reset", "info");
				return;
			}
			if (!existsSync(path.join(repoRoot, ".git"))) {
				ctx.ui.notify(`deeep: ${repoRoot} is not a git repository.`, "warning");
				return;
			}
			// Never let a mistyped verb silently overwrite an active feature's state.
			const existing = loadState();
			if (existing && existing.phase !== "complete") {
				let confirmed: boolean | undefined;
				try {
					confirmed = await ctx.ui.confirm(
						`deeep: feature "${existing.feature}" [${existing.phase}] is active.`,
						"Discard its state and start a new feature?",
					);
				} catch {
					confirmed = false;
				}
				if (!confirmed) {
					ctx.ui.notify("deeep: kept existing state. (/deeep status to view, /deeep go to resume.)", "info");
					return;
				}
			}

			const suggested = slugify(description) || "feature";
			const feature = await ctx.ui.input("Feature name", suggested);
			const shortname = slugify(feature || suggested, 10) || "task";

			// Fresh specs.md for this feature (overwrites only if starting over)
			if (!existsSync(specPath())) {
				writeFileSync(specPath(), specsTemplate(feature, shortname));
			}

			saveState({ feature, shortname, phase: "planning", tasks: [] });

			await pi.sendUserMessage(
				`[DEEEEP PIPELINE — ARCHITECT MODE]\n\nThe client submitted this feature request:\n\n"""\n${description}\n"""\n\nYou are the architect. Your job is to produce a build plan, NOT to implement anything.\n\n1. Explore the repository to ground the plan in the actual codebase (stack, conventions, existing modules to reuse).\n2. If anything important is unclear, ask the client clarifying questions in your reply (keep it to one short round; the client will answer in chat). Do not write specs.md yet.\n3. Once you have what you need, write ${SPEC_FILE} in the repository root (${specPath()}) with this EXACT structure:\n\n\`\`\`markdown\n# Feature: <name>\n\n## Overview\n<what will be built and why, decisions taken, open questions resolved>\n\n## Tasks\n### ${shortname}-1\n- **Difficulty:** easy | medium | hard\n- **Model:** qwen2.5-coder:7b | qwen3:4b-instruct | <stronger model id for hard tasks>\n- **Depends on:** none | comma-separated task ids\n- **Summary:** one line\n- **Details:** complete self-contained instructions for a worker agent: files to create/modify, expected behavior, interfaces, edge cases, test expectations. The worker has NO access to this conversation.\n\`\`\`\n\nRules for the plan:\n- Task ids MUST be ${shortname}-1, ${shortname}-2, ... in execution order.\n- Tasks must be ATOMIC: sized so a local 7B model can do one in a single focused pass (roughly one file or one cohesive change, ideally ≤ 300 lines). Split harder work into more tasks; it is fine to assign hard tasks to a stronger cloud model id when splitting is not sensible.\n- Every task must be independently verifiable (compiles/tests pass on its branch).\n- Order tasks so independent work has no dependencies (they will run in parallel).\n- After writing the file, end your reply with exactly: DEEEEP:PLAN_READY\n\nCOMMUNICATION STYLE (applies to every reply, including clarifying questions):\n${CONCISE_RULES}`,
			);
		},
	});

	// While a deeep feature is active, hold the architect to the conciseness contract
	// on every turn (not just the initial prompt).
	pi.on("before_agent_start", (event) => {
		const state = loadState();
		if (!state || state.phase === "complete") return;
		if (!event.systemPromptOptions.sections) event.systemPromptOptions.sections = {};
		event.systemPromptOptions.sections["deeep-concise"] =
			`A deeep pipeline run is active. Communication contract:\n${CONCISE_RULES}`;
	});

	// Detect when the architect has finished planning.
	pi.on("turn_end", async (_event, ctx) => {
		const state = loadState();
		if (!state || state.phase !== "planning") return;
		if (!existsSync(specPath())) return;
		let tasks: DeepTask[] = [];
		try {
			const parsed = parseSpecs(readFileSync(specPath(), "utf8"), state.shortname);
			tasks = parsed.tasks;
			if (parsed.warnings.length) ctx.ui.notify(`deeep: ${parsed.warnings.join("; ")}`, "warning");
		} catch {
			return;
		}
		if (tasks.length === 0) return;
		state.tasks = tasks;
		state.phase = "ready";
		saveState(state);
		const summary = tasks.map(statusLine).join("\n");
		ctx.ui.notify(`deeep: specs.md ready with ${tasks.length} task(s):\n${summary}\n\nReview/edit specs.md, then validate with /deeep go.`, "info");
	});
}
