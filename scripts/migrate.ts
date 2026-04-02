import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

interface CliOptions {
	directory: string;
	endpoint: string;
	secret: string;
	dryRun: boolean;
}

interface EpubCandidate {
	path: string;
	birthtime: Date;
	size: number;
}

interface ParseResult {
	success: boolean;
	options?: CliOptions;
	exitCode?: number;
}

const DEFAULT_ENDPOINT =
	process.env.MIGRATION_ENDPOINT ??
	"http://localhost:8787/api/migration/import-epub";

function printUsage() {
	console.log(`
Usage:
  pnpm migrate:epub -- --dir /path/to/epubs [--endpoint URL] [--secret TOKEN] [--dry-run]

Required:
  --dir <path>       Root folder containing .epub files

Optional:
  --endpoint <url>   Migration API endpoint
                     Default: ${DEFAULT_ENDPOINT}
  --secret <token>   Migration secret (or use MIGRATION_SECRET env)
  --dry-run          Scan and print order without uploading
  --help             Show this help
`);
}

function parseArgs(argv: string[]): ParseResult {
	let directory = "";
	let endpoint = DEFAULT_ENDPOINT;
	let secret = process.env.MIGRATION_SECRET ?? "";
	let dryRun = false;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			printUsage();
			return { success: false, exitCode: 0 };
		}

		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}

		if (arg === "--dir") {
			directory = argv[i + 1] ?? "";
			i += 1;
			continue;
		}

		if (arg === "--endpoint") {
			endpoint = argv[i + 1] ?? "";
			i += 1;
			continue;
		}

		if (arg === "--secret") {
			secret = argv[i + 1] ?? "";
			i += 1;
			continue;
		}

		if (!arg.startsWith("-") && !directory) {
			directory = arg;
		}
	}

	if (!directory) {
		console.error("Missing --dir argument");
		printUsage();
		return { success: false, exitCode: 1 };
	}

	if (!dryRun && !secret.trim()) {
		console.error("Missing migration secret: set --secret or MIGRATION_SECRET env");
		return { success: false, exitCode: 1 };
	}

	return {
		success: true,
		options: {
			directory: resolve(directory),
			endpoint,
			secret: secret.trim(),
			dryRun,
		},
	};
}

function isEpubFile(path: string): boolean {
	return path.toLowerCase().endsWith(".epub");
}

function hasValidBirthtime(date: Date): boolean {
	const time = date.getTime();
	return Number.isFinite(time) && time > 0;
}

async function collectEpubCandidates(root: string): Promise<EpubCandidate[]> {
	const files: EpubCandidate[] = [];
	const queue: string[] = [root];

	while (queue.length > 0) {
		const current = queue.pop();
		if (!current) {
			continue;
		}

		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = resolve(current, entry.name);
			if (entry.isDirectory()) {
				queue.push(fullPath);
				continue;
			}

			if (!entry.isFile() || !isEpubFile(entry.name)) {
				continue;
			}

			const stats = await stat(fullPath);
			if (!hasValidBirthtime(stats.birthtime)) {
				console.warn(`[SKIP] Invalid birthtime: ${fullPath}`);
				continue;
			}

			files.push({
				path: fullPath,
				birthtime: stats.birthtime,
				size: stats.size,
			});
		}
	}

	files.sort((a, b) => {
		const diff = a.birthtime.getTime() - b.birthtime.getTime();
		if (diff !== 0) {
			return diff;
		}
		return a.path.localeCompare(b.path);
	});

	return files;
}

async function uploadCandidate(
	candidate: EpubCandidate,
	options: CliOptions,
): Promise<{ ok: true; bookId: string } | { ok: false; error: string }> {
	try {
		const bytes = await readFile(candidate.path);
		const file = new File([bytes], basename(candidate.path), {
			type: "application/epub+zip",
			lastModified: candidate.birthtime.getTime(),
		});

		const formData = new FormData();
		formData.set("file", file);
		formData.set("customCreatedAt", candidate.birthtime.toISOString());

		const response = await fetch(options.endpoint, {
			method: "POST",
			headers: {
				"x-migration-secret": options.secret,
			},
			body: formData,
		});

		const text = await response.text();
		let payload: unknown;
		try {
			payload = text ? JSON.parse(text) : {};
		} catch {
			payload = { raw: text };
		}

		if (!response.ok) {
			return {
				ok: false,
				error:
					typeof payload === "object" &&
					payload !== null &&
					"error" in payload &&
					typeof payload.error === "string"
						? payload.error
						: `HTTP ${response.status}`,
			};
		}

		if (
			typeof payload === "object" &&
			payload !== null &&
			"bookId" in payload &&
			typeof payload.bookId === "string"
		) {
			return { ok: true, bookId: payload.bookId };
		}

		return { ok: false, error: "Missing bookId in response" };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Unknown upload error",
		};
	}
}

async function run() {
	const parsed = parseArgs(process.argv.slice(2));
	if (!parsed.success || !parsed.options) {
		process.exitCode = parsed.exitCode ?? 1;
		return;
	}

	const options = parsed.options;
	console.log(`Scanning EPUB files under: ${options.directory}`);
	const candidates = await collectEpubCandidates(options.directory);

	if (candidates.length === 0) {
		console.log("No EPUB files found.");
		return;
	}

	console.log(`Found ${candidates.length} EPUB file(s).`);
	console.log(`Endpoint: ${options.endpoint}`);
	if (options.dryRun) {
		console.log("Running in dry-run mode. No files will be uploaded.");
	}

	let successCount = 0;
	let failedCount = 0;

	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i];
		const index = `${i + 1}/${candidates.length}`;
		const createdAtIso = candidate.birthtime.toISOString();

		if (options.dryRun) {
			console.log(
				`[DRY-RUN ${index}] ${candidate.path} | createdAt=${createdAtIso}`,
			);
			continue;
		}

		const result = await uploadCandidate(candidate, options);
		if (result.ok) {
			successCount += 1;
			console.log(
				`[OK ${index}] ${candidate.path} -> bookId=${result.bookId} | createdAt=${createdAtIso}`,
			);
		} else {
			failedCount += 1;
			console.error(
				`[FAIL ${index}] ${candidate.path} | createdAt=${createdAtIso} | reason=${result.error}`,
			);
		}
	}

	console.log("Migration finished.");
	console.log(`Success: ${successCount}`);
	console.log(`Failed: ${failedCount}`);

	if (failedCount > 0) {
		process.exitCode = 1;
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
