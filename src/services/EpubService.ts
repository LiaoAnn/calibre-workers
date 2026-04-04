import "@tanstack/react-start/server-only";

import { Effect } from "effect";
import { inflateSync, strFromU8, unzipSync } from "fflate";
import { ParseError } from "#/lib/errors";
import { getBookFileRange } from "#/services/FileService";

export interface EpubMetadata {
	title?: string;
	/** Multiple authors; comma-joined for display. TODO: link to individual author profile pages */
	authors?: string[];
	description?: string;
	publisher?: string;
	tags?: string[];
	language?: string;
	pubdate?: string;
	series?: string;
	seriesIndex?: number;
	identifiers?: { type: string; value: string }[];
}

export interface EpubCover {
	data: Uint8Array;
	mimeType: string;
}

const XML_ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decodeXmlEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity) => {
		if (entity.startsWith("#x")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			return Number.isNaN(codePoint) ? _ : String.fromCodePoint(codePoint);
		}

		if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			return Number.isNaN(codePoint) ? _ : String.fromCodePoint(codePoint);
		}

		return XML_ENTITY_MAP[entity] ?? _;
	});
}

function readZipText(
	entries: Record<string, Uint8Array>,
	path: string,
): string | undefined {
	const data = entries[path] ?? entries[path.replace(/^\.\//, "")];
	return data ? strFromU8(data) : undefined;
}

function extractTagContent(xml: string, tag: string): string | undefined {
	const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const expression = new RegExp(
		`<(?:[a-zA-Z0-9_]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${escapedTag}>`,
		"i",
	);
	const matched = expression.exec(xml);
	if (!matched?.[1]) {
		return undefined;
	}

	const normalized = decodeXmlEntities(matched[1].replace(/\s+/g, " ").trim());
	return normalized.length > 0 ? normalized : undefined;
}

function extractAllTagContents(xml: string, tag: string): string[] {
	const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const expression = new RegExp(
		`<(?:[a-zA-Z0-9_]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${escapedTag}>`,
		"gi",
	);
	const results: string[] = [];
	for (const match of xml.matchAll(expression)) {
		if (match[1]) {
			const normalized = decodeXmlEntities(
				match[1].replace(/\s+/g, " ").trim(),
			);
			if (normalized.length > 0) results.push(normalized);
		}
	}
	return results;
}

function extractIdentifiers(xml: string): { type: string; value: string }[] {
	const expression =
		/<(?:[a-zA-Z0-9_]+:)?identifier\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?identifier>/gi;
	const results: { type: string; value: string }[] = [];
	for (const match of xml.matchAll(expression)) {
		const attrs = match[1] ?? "";
		const raw = match[2] ?? "";
		const value = decodeXmlEntities(raw.replace(/\s+/g, " ").trim());
		if (!value) continue;
		// Skip UUID identifiers
		if (
			/^urn:uuid:/i.test(value) ||
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				value,
			)
		)
			continue;
		// opf:scheme or scheme attribute → use as identifier type
		const schemeMatch = /(?:opf:)?scheme\s*=\s*["']([^"']+)["']/i.exec(attrs);
		if (schemeMatch?.[1]) {
			results.push({ type: schemeMatch[1].toLowerCase(), value });
		} else {
			// urn:type:value format (e.g. urn:isbn:978...)
			const urnMatch = /^urn:([^:]+):(.+)$/i.exec(value);
			if (urnMatch?.[1] && urnMatch[2]) {
				results.push({
					type: urnMatch[1].toLowerCase(),
					value: urnMatch[2],
				});
			}
		}
	}
	return results;
}

function findOpfPath(entries: Record<string, Uint8Array>): string | undefined {
	const containerXml = readZipText(entries, "META-INF/container.xml");
	if (containerXml) {
		const match = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
		if (match?.[1] && entries[match[1]]) {
			return match[1];
		}
	}

	return Object.keys(entries).find((path) =>
		path.toLowerCase().endsWith(".opf"),
	);
}

interface ZipCentralDirectoryEntry {
	path: string;
	compressionMethod: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP32_LIMIT = 0xffffffff;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_EOCD_MAX_COMMENT_BYTES = 65535;
const ZIP_EOCD_SUFFIX_BYTES = 128 * 1024;
const ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
const ZIP_MAX_ENTRY_COMPRESSED_BYTES = 32 * 1024 * 1024;
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

const toParseError = (stage: string, cause: unknown) =>
	new ParseError({ stage, cause });

const readUInt16LE = (bytes: Uint8Array, offset: number) =>
	bytes[offset] | (bytes[offset + 1] << 8);

const readUInt32LE = (bytes: Uint8Array, offset: number) =>
	(bytes[offset] |
		(bytes[offset + 1] << 8) |
		(bytes[offset + 2] << 16) |
		(bytes[offset + 3] << 24)) >>>
	0;

const parseMetadataFromOpfXml = (opfXml: string): EpubMetadata => {
	const authors = extractAllTagContents(opfXml, "creator");
	const tags = extractAllTagContents(opfXml, "subject");
	const identifiers = extractIdentifiers(opfXml);

	let series: string | undefined;
	let seriesIndex: number | undefined;
	const calibreSeriesMeta = /<meta\b[^>]*\bname="calibre:series"\b[^>]*>/i.exec(
		opfXml,
	);
	if (calibreSeriesMeta) {
		const c = /content="([^"]+)"/.exec(calibreSeriesMeta[0]);
		if (c?.[1]) series = decodeXmlEntities(c[1]);
	}

	if (!series) {
		const epub3 =
			/<meta\b[^>]*\bproperty="belongs-to-collection"[^>]*>([\s\S]*?)<\/meta>/i.exec(
				opfXml,
			);
		if (epub3?.[1]) series = decodeXmlEntities(epub3[1].trim());
	}

	const calibreIndexMeta =
		/<meta\b[^>]*\bname="calibre:series_index"\b[^>]*>/i.exec(opfXml);
	if (calibreIndexMeta) {
		const c = /content="([^"]+)"/.exec(calibreIndexMeta[0]);
		if (c?.[1]) {
			const idx = Number.parseFloat(c[1]);
			if (!Number.isNaN(idx)) seriesIndex = idx;
		}
	}

	if (seriesIndex === undefined) {
		const groupPos =
			/<meta\b[^>]*\bproperty="group-position"[^>]*>([\s\S]*?)<\/meta>/i.exec(
				opfXml,
			);
		if (groupPos?.[1]) {
			const idx = Number.parseFloat(groupPos[1].trim());
			if (!Number.isNaN(idx)) seriesIndex = idx;
		}
	}

	return {
		title: extractTagContent(opfXml, "title"),
		authors: authors.length > 0 ? authors : undefined,
		description: extractTagContent(opfXml, "description"),
		publisher: extractTagContent(opfXml, "publisher"),
		tags: tags.length > 0 ? tags : undefined,
		language: extractTagContent(opfXml, "language"),
		pubdate: extractTagContent(opfXml, "date"),
		series,
		seriesIndex,
		identifiers: identifiers.length > 0 ? identifiers : undefined,
	};
};

const findEndOfCentralDirectoryOffset = (tailBytes: Uint8Array): number => {
	for (
		let offset = tailBytes.byteLength - ZIP_EOCD_MIN_BYTES;
		offset >= 0;
		offset -= 1
	) {
		if (readUInt32LE(tailBytes, offset) !== ZIP_EOCD_SIGNATURE) {
			continue;
		}

		const commentLength = readUInt16LE(tailBytes, offset + 20);
		if (offset + ZIP_EOCD_MIN_BYTES + commentLength <= tailBytes.byteLength) {
			return offset;
		}
	}

	throw new Error("Could not locate ZIP end of central directory record");
};

const parseCentralDirectoryEntries = (
	centralDirectoryBytes: Uint8Array,
): ZipCentralDirectoryEntry[] => {
	const entries: ZipCentralDirectoryEntry[] = [];
	let offset = 0;

	while (offset < centralDirectoryBytes.byteLength) {
		if (offset + 46 > centralDirectoryBytes.byteLength) {
			throw new Error("Truncated ZIP central directory entry");
		}

		if (
			readUInt32LE(centralDirectoryBytes, offset) !==
			ZIP_CENTRAL_FILE_HEADER_SIGNATURE
		) {
			throw new Error("Invalid ZIP central directory header");
		}

		const compressionMethod = readUInt16LE(centralDirectoryBytes, offset + 10);
		const compressedSize = readUInt32LE(centralDirectoryBytes, offset + 20);
		const uncompressedSize = readUInt32LE(centralDirectoryBytes, offset + 24);
		const fileNameLength = readUInt16LE(centralDirectoryBytes, offset + 28);
		const extraFieldLength = readUInt16LE(centralDirectoryBytes, offset + 30);
		const fileCommentLength = readUInt16LE(centralDirectoryBytes, offset + 32);
		const localHeaderOffset = readUInt32LE(centralDirectoryBytes, offset + 42);

		const dataStart = offset + 46;
		const dataEnd =
			dataStart + fileNameLength + extraFieldLength + fileCommentLength;
		if (dataEnd > centralDirectoryBytes.byteLength) {
			throw new Error("Truncated ZIP central directory payload");
		}

		if (
			compressedSize === ZIP32_LIMIT ||
			uncompressedSize === ZIP32_LIMIT ||
			localHeaderOffset === ZIP32_LIMIT
		) {
			throw new Error("ZIP64 archives are not supported");
		}

		const fileNameBytes = centralDirectoryBytes.slice(
			dataStart,
			dataStart + fileNameLength,
		);
		const path = normalizeZipPath(strFromU8(fileNameBytes));
		if (path.length > 0) {
			entries.push({
				path,
				compressionMethod,
				compressedSize,
				uncompressedSize,
				localHeaderOffset,
			});
		}

		offset = dataEnd;
	}

	return entries;
};

export const parseEpubMetadataAndCoverFromR2 = ({ r2Key }: { r2Key: string }) =>
	Effect.gen(function* () {
		const readRange = (range: R2Range, stage: string) =>
			getBookFileRange({ r2Key, range }).pipe(
				Effect.mapError((cause) => toParseError(stage, cause)),
			);

		const readFixedRange = (offset: number, length: number, stage: string) =>
			readRange({ offset, length }, stage).pipe(
				Effect.flatMap((bytes) =>
					bytes.byteLength === length
						? Effect.succeed(bytes)
						: Effect.fail(
								toParseError(
									stage,
									`Incomplete range read. Expected ${length} bytes, got ${bytes.byteLength}`,
								),
							),
				),
			);

		// ZIP 的目錄在檔案尾端，先讀尾端即可取得完整索引位置。
		const eocdTail = yield* readRange(
			{ suffix: ZIP_EOCD_SUFFIX_BYTES },
			"epub.range.tail",
		);

		if (eocdTail.byteLength < ZIP_EOCD_MIN_BYTES) {
			return yield* Effect.fail(
				toParseError("epub.range.tail", "ZIP tail is too short"),
			);
		}

		const eocdOffset = yield* Effect.try({
			try: () => findEndOfCentralDirectoryOffset(eocdTail),
			catch: (cause) => toParseError("epub.zip.eocd", cause),
		});

		const centralDirectorySize = readUInt32LE(eocdTail, eocdOffset + 12);
		const centralDirectoryOffset = readUInt32LE(eocdTail, eocdOffset + 16);
		const diskNumber = readUInt16LE(eocdTail, eocdOffset + 4);
		const centralDirDiskNumber = readUInt16LE(eocdTail, eocdOffset + 6);
		const zipCommentLength = readUInt16LE(eocdTail, eocdOffset + 20);

		if (zipCommentLength > ZIP_EOCD_MAX_COMMENT_BYTES) {
			return yield* Effect.fail(
				toParseError("epub.zip.eocd", "ZIP comment exceeds max length"),
			);
		}

		if (diskNumber !== 0 || centralDirDiskNumber !== 0) {
			return yield* Effect.fail(
				toParseError(
					"epub.zip.eocd",
					"Multi-disk ZIP archives are not supported",
				),
			);
		}

		if (
			centralDirectorySize === ZIP32_LIMIT ||
			centralDirectoryOffset === ZIP32_LIMIT
		) {
			return yield* Effect.fail(
				toParseError("epub.zip.eocd", "ZIP64 archives are not supported"),
			);
		}

		if (
			centralDirectorySize <= 0 ||
			centralDirectorySize > ZIP_MAX_CENTRAL_DIRECTORY_BYTES
		) {
			return yield* Effect.fail(
				toParseError(
					"epub.zip.centralDirectory",
					`Unexpected central directory size: ${centralDirectorySize}`,
				),
			);
		}

		const centralDirectoryBytes = yield* readFixedRange(
			centralDirectoryOffset,
			centralDirectorySize,
			"epub.range.centralDirectory",
		);

		const indexedEntries = yield* Effect.try({
			try: () => parseCentralDirectoryEntries(centralDirectoryBytes),
			catch: (cause) => toParseError("epub.zip.centralDirectory", cause),
		});

		if (indexedEntries.length === 0) {
			return yield* Effect.fail(
				toParseError("epub.zip.centralDirectory", "No ZIP entries found"),
			);
		}

		const entriesByPath = new Map<string, ZipCentralDirectoryEntry>();
		const entriesByPathLower = new Map<string, string>();
		for (const entry of indexedEntries) {
			entriesByPath.set(entry.path, entry);
			entriesByPathLower.set(entry.path.toLowerCase(), entry.path);
		}

		const resolveIndexedPath = (path: string): string | undefined => {
			const normalizedPath = normalizeZipPath(path);
			const noDotPrefix = normalizedPath.replace(/^\.\//, "");

			return (
				(entriesByPath.has(normalizedPath) ? normalizedPath : undefined) ??
				(entriesByPath.has(noDotPrefix) ? noDotPrefix : undefined) ??
				entriesByPathLower.get(normalizedPath.toLowerCase()) ??
				entriesByPathLower.get(noDotPrefix.toLowerCase())
			);
		};

		const entryContentCache = new Map<string, Uint8Array>();

		const readEntryContent = (path: string, stage: string) =>
			Effect.gen(function* () {
				const resolvedPath = resolveIndexedPath(path);
				if (!resolvedPath) {
					return yield* Effect.fail(
						toParseError(stage, `ZIP entry not found: ${path}`),
					);
				}

				const cached = entryContentCache.get(resolvedPath);
				if (cached) {
					return cached;
				}

				const entry = entriesByPath.get(resolvedPath);
				if (!entry) {
					return yield* Effect.fail(
						toParseError(stage, `ZIP entry index missing: ${resolvedPath}`),
					);
				}

				if (entry.compressedSize > ZIP_MAX_ENTRY_COMPRESSED_BYTES) {
					return yield* Effect.fail(
						toParseError(
							stage,
							`ZIP entry is too large to parse safely: ${entry.path}`,
						),
					);
				}

				// 先讀 local file header，才能知道壓縮資料的實際起點。
				const localHeaderBytes = yield* readFixedRange(
					entry.localHeaderOffset,
					30,
					`${stage}.localHeader`,
				);

				if (
					readUInt32LE(localHeaderBytes, 0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE
				) {
					return yield* Effect.fail(
						toParseError(stage, "Invalid ZIP local file header signature"),
					);
				}

				const localFileNameLength = readUInt16LE(localHeaderBytes, 26);
				const localExtraFieldLength = readUInt16LE(localHeaderBytes, 28);
				const entryDataOffset =
					entry.localHeaderOffset +
					30 +
					localFileNameLength +
					localExtraFieldLength;

				const compressedBytes =
					entry.compressedSize === 0
						? new Uint8Array(0)
						: yield* readFixedRange(
								entryDataOffset,
								entry.compressedSize,
								`${stage}.entryBody`,
							);

				const data = yield* Effect.try({
					try: () => {
						switch (entry.compressionMethod) {
							case 0:
								return compressedBytes;
							case 8:
								return inflateSync(compressedBytes);
							default:
								throw new Error(
									`Unsupported ZIP compression method: ${entry.compressionMethod}`,
								);
						}
					},
					catch: (cause) => toParseError(`${stage}.inflate`, cause),
				});

				if (data.byteLength > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
					return yield* Effect.fail(
						toParseError(
							stage,
							`ZIP entry inflated data is too large: ${entry.path}`,
						),
					);
				}

				if (
					entry.uncompressedSize !== ZIP32_LIMIT &&
					data.byteLength !== entry.uncompressedSize
				) {
					return yield* Effect.fail(
						toParseError(stage, `ZIP entry size mismatch: ${entry.path}`),
					);
				}

				entryContentCache.set(resolvedPath, data);
				return data;
			});

		const readEntryText = (path: string, stage: string) =>
			readEntryContent(path, stage).pipe(
				Effect.map((bytes) => strFromU8(bytes)),
			);

		const containerPath = resolveIndexedPath("META-INF/container.xml");
		let opfPath: string | undefined;

		if (containerPath) {
			const containerXml = yield* readEntryText(
				containerPath,
				"epub.container",
			);
			const match = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
			if (match?.[1]) {
				opfPath = resolveIndexedPath(match[1]);
			}
		}

		if (!opfPath) {
			opfPath = Array.from(entriesByPath.keys()).find((path) =>
				path.toLowerCase().endsWith(".opf"),
			);
		}

		if (!opfPath) {
			return yield* Effect.fail(
				toParseError(
					"epub.opf",
					"Invalid EPUB: missing package document (.opf)",
				),
			);
		}

		const opfXml = yield* readEntryText(opfPath, "epub.opf");
		const metadata = yield* Effect.try({
			try: () => parseMetadataFromOpfXml(opfXml),
			catch: (cause) => toParseError("epub.metadata", cause),
		});

		const cover = yield* Effect.gen(function* () {
			const opfDir = opfPath.includes("/")
				? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
				: "";

			let coverHref: string | undefined;
			let coverMimeType: string | undefined;
			const itemTags = opfXml.match(/<item\b[^>]*>/gi) ?? [];
			const manifestItems = itemTags
				.map((tag) => ({
					id: getXmlAttr(tag, "id"),
					href: getXmlAttr(tag, "href"),
					mediaType: getXmlAttr(tag, "media-type"),
					properties: getXmlAttr(tag, "properties"),
				}))
				.filter((item) => !!item.href);

			const findManifestItemByHref = (href: string, baseDir = opfDir) => {
				const targetPath = normalizeEntryPath(baseDir, href);
				return manifestItems.find((item) => {
					if (!item.href) return false;
					return normalizeEntryPath(opfDir, item.href) === targetPath;
				});
			};

			const epub3Item = manifestItems.find((item) => {
				const properties = item.properties;
				return properties
					? properties.split(/\s+/).includes("cover-image")
					: false;
			});
			if (epub3Item) {
				coverHref = epub3Item.href;
				coverMimeType = epub3Item.mediaType;
			}

			if (!coverHref) {
				const idItem = manifestItems.find((item) => {
					const id = item.id?.toLowerCase();
					return id === "cover-image" || id === "cover";
				});
				if (idItem) {
					coverHref = idItem.href;
					coverMimeType = idItem.mediaType;
				}
			}

			if (!coverHref) {
				const metaTags = opfXml.match(/<meta\b[^>]*>/gi) ?? [];
				const coverMeta = metaTags.find(
					(tag) => getXmlAttr(tag, "name")?.toLowerCase() === "cover",
				);
				const coverId = coverMeta
					? getXmlAttr(coverMeta, "content")
					: undefined;

				if (coverId) {
					const item = manifestItems.find(
						(item) => item.id?.toLowerCase() === coverId.toLowerCase(),
					);
					if (item) {
						coverHref = item.href;
						coverMimeType = item.mediaType;
					}
				}
			}

			if (!coverHref) {
				const guideReferenceTags = opfXml.match(/<reference\b[^>]*>/gi) ?? [];
				const coverReference = guideReferenceTags.find((tag) =>
					(getXmlAttr(tag, "type") ?? "").toLowerCase().includes("cover"),
				);

				if (coverReference) {
					coverHref = getXmlAttr(coverReference, "href");
					const guideManifestItem = coverHref
						? findManifestItemByHref(coverHref)
						: undefined;
					coverMimeType = guideManifestItem?.mediaType;
				}
			}

			if (!coverHref) {
				const manifestCoverItem = manifestItems.find((item) => {
					const id = (item.id ?? "").toLowerCase();
					const href = (item.href ?? "").toLowerCase();
					const mediaType = (item.mediaType ?? "").toLowerCase();

					return (
						mediaType.startsWith("image/") &&
						(id.includes("cover") || href.includes("cover"))
					);
				});

				if (manifestCoverItem) {
					coverHref = manifestCoverItem.href;
					coverMimeType = manifestCoverItem.mediaType;
				}
			}

			if (!coverHref) {
				return undefined;
			}

			let currentHref = coverHref;
			let currentBaseDir = opfDir;
			let currentMimeType = coverMimeType;

			for (let depth = 0; depth < 3; depth += 1) {
				const candidatePath = normalizeEntryPath(currentBaseDir, currentHref);
				const resolvedPath = resolveIndexedPath(candidatePath);
				if (!resolvedPath) {
					return undefined;
				}

				const data = yield* readEntryContent(resolvedPath, "epub.cover");

				const manifestItem = findManifestItemByHref(
					currentHref,
					currentBaseDir,
				);
				const resolvedMimeType =
					currentMimeType ??
					manifestItem?.mediaType ??
					inferCoverMimeTypeFromPath(resolvedPath);

				if (!isContentDocumentReference(resolvedPath, resolvedMimeType)) {
					const finalMimeType = resolvedMimeType
						.toLowerCase()
						.startsWith("image/")
						? resolvedMimeType
						: inferCoverMimeTypeFromPath(resolvedPath);

					return {
						data,
						mimeType: finalMimeType,
					};
				}

				const contentDocMarkup = strFromU8(data);
				const embeddedCoverHref =
					extractImageHrefFromContentDocument(contentDocMarkup);
				if (!embeddedCoverHref) {
					return undefined;
				}

				currentBaseDir = resolvedPath.includes("/")
					? resolvedPath.substring(0, resolvedPath.lastIndexOf("/") + 1)
					: "";
				currentHref = embeddedCoverHref;
				currentMimeType = findManifestItemByHref(
					embeddedCoverHref,
					currentBaseDir,
				)?.mediaType;
			}

			return undefined;
		}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

		return {
			metadata,
			cover,
		};
	});

export const parseEpubMetadata = (buffer: ArrayBuffer) =>
	Effect.try({
		try: () => {
			const entries = unzipSync(new Uint8Array(buffer));
			const opfPath = findOpfPath(entries);
			if (!opfPath) {
				throw new Error("Invalid EPUB: missing package document (.opf)");
			}

			const opfXml = readZipText(entries, opfPath);
			if (!opfXml) {
				throw new Error("Invalid EPUB: unreadable package document (.opf)");
			}

			return parseMetadataFromOpfXml(opfXml);
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.metadata",
				cause,
			}),
	});

function getXmlAttr(tag: string, name: string): string | undefined {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
		"i",
	).exec(tag);
	return match?.[2];
}

function normalizeZipPath(path: string): string {
	const cleaned = path.replace(/\\/g, "/").replace(/^\/+/, "");
	const segments = cleaned.split("/");
	const normalized: string[] = [];

	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			normalized.pop();
			continue;
		}
		normalized.push(segment);
	}

	return normalized.join("/");
}

function resolveEntryData(
	entries: Record<string, Uint8Array>,
	baseDir: string,
	href: string,
): Uint8Array | undefined {
	const decodedHref = decodeURIComponent(href.trim());
	const candidate = normalizeZipPath(`${baseDir}${decodedHref}`);
	const noDotPrefix = candidate.replace(/^\.\//, "");

	return (
		entries[candidate] ??
		entries[noDotPrefix] ??
		entries[decodeURIComponent(candidate)]
	);
}

function normalizeEntryPath(baseDir: string, href: string): string {
	const decodedHref = decodeURIComponent(href.trim());
	return normalizeZipPath(`${baseDir}${decodedHref}`);
}

function inferCoverMimeTypeFromPath(path: string): string {
	const normalizedPath = path.toLowerCase();

	if (normalizedPath.endsWith(".png")) return "image/png";
	if (normalizedPath.endsWith(".gif")) return "image/gif";
	if (normalizedPath.endsWith(".webp")) return "image/webp";
	if (normalizedPath.endsWith(".svg")) return "image/svg+xml";
	return "image/jpeg";
}

function isContentDocumentReference(path: string, mimeType?: string): boolean {
	const normalizedMimeType = (mimeType ?? "").toLowerCase();
	const normalizedPath = path.toLowerCase();

	if (normalizedMimeType.startsWith("image/")) {
		return false;
	}

	return (
		normalizedMimeType.includes("xhtml") ||
		normalizedMimeType.includes("html") ||
		normalizedPath.endsWith(".xhtml") ||
		normalizedPath.endsWith(".html") ||
		normalizedPath.endsWith(".htm")
	);
}

function extractImageHrefFromContentDocument(
	markup: string,
): string | undefined {
	const imageTags = markup.match(/<(?:img|image)\b[^>]*>/gi) ?? [];

	for (const tag of imageTags) {
		const href =
			getXmlAttr(tag, "src") ??
			getXmlAttr(tag, "href") ??
			getXmlAttr(tag, "xlink:href");
		const normalizedHref = href?.trim();

		if (
			normalizedHref &&
			normalizedHref.length > 0 &&
			!normalizedHref.startsWith("data:") &&
			!/^https?:\/\//i.test(normalizedHref)
		) {
			return normalizedHref;
		}
	}

	return undefined;
}

export const parseEpubCover = (buffer: ArrayBuffer) =>
	Effect.try({
		try: (): EpubCover | undefined => {
			const entries = unzipSync(new Uint8Array(buffer));
			const opfPath = findOpfPath(entries);
			if (!opfPath) return undefined;

			const opfXml = readZipText(entries, opfPath);
			if (!opfXml) return undefined;

			const opfDir = opfPath.includes("/")
				? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
				: "";

			let coverHref: string | undefined;
			let coverMimeType: string | undefined;
			const itemTags = opfXml.match(/<item\b[^>]*>/gi) ?? [];
			const manifestItems = itemTags
				.map((tag) => ({
					id: getXmlAttr(tag, "id"),
					href: getXmlAttr(tag, "href"),
					mediaType: getXmlAttr(tag, "media-type"),
					properties: getXmlAttr(tag, "properties"),
				}))
				.filter((item) => !!item.href);

			const findManifestItemByHref = (href: string, baseDir = opfDir) => {
				const targetPath = normalizeEntryPath(baseDir, href);
				return manifestItems.find((item) => {
					if (!item.href) return false;
					return normalizeEntryPath(opfDir, item.href) === targetPath;
				});
			};

			// EPUB 3: <item properties="cover-image" .../>
			const epub3Item = manifestItems.find((item) => {
				const properties = item.properties;
				return properties
					? properties.split(/\s+/).includes("cover-image")
					: false;
			});
			if (epub3Item) {
				coverHref = epub3Item.href;
				coverMimeType = epub3Item.mediaType;
			}

			// EPUB 2/3: <item id="cover-image|cover" .../>
			if (!coverHref) {
				const idItem = manifestItems.find((item) => {
					const id = item.id?.toLowerCase();
					return id === "cover-image" || id === "cover";
				});
				if (idItem) {
					coverHref = idItem.href;
					coverMimeType = idItem.mediaType;
				}
			}

			// EPUB 2 fallback: <meta name="cover" content="<item-id>"/>
			if (!coverHref) {
				const metaTags = opfXml.match(/<meta\b[^>]*>/gi) ?? [];
				const coverMeta = metaTags.find(
					(tag) => getXmlAttr(tag, "name")?.toLowerCase() === "cover",
				);
				const coverId = coverMeta
					? getXmlAttr(coverMeta, "content")
					: undefined;

				if (coverId) {
					const item = manifestItems.find(
						(item) => item.id?.toLowerCase() === coverId.toLowerCase(),
					);
					if (item) {
						coverHref = item.href;
						coverMimeType = item.mediaType;
					}
				}
			}

			// EPUB 2 guide: <reference type="cover" href="..."/>
			if (!coverHref) {
				const guideReferenceTags = opfXml.match(/<reference\b[^>]*>/gi) ?? [];
				const coverReference = guideReferenceTags.find((tag) =>
					(getXmlAttr(tag, "type") ?? "").toLowerCase().includes("cover"),
				);

				if (coverReference) {
					coverHref = getXmlAttr(coverReference, "href");
					const guideManifestItem = coverHref
						? findManifestItemByHref(coverHref)
						: undefined;
					coverMimeType = guideManifestItem?.mediaType;
				}
			}

			// Heuristic fallback: image entry whose id/href includes "cover".
			if (!coverHref) {
				const manifestCoverItem = manifestItems.find((item) => {
					const id = (item.id ?? "").toLowerCase();
					const href = (item.href ?? "").toLowerCase();
					const mediaType = (item.mediaType ?? "").toLowerCase();

					return (
						mediaType.startsWith("image/") &&
						(id.includes("cover") || href.includes("cover"))
					);
				});

				if (manifestCoverItem) {
					coverHref = manifestCoverItem.href;
					coverMimeType = manifestCoverItem.mediaType;
				}
			}

			if (!coverHref) return undefined;

			let currentHref = coverHref;
			let currentBaseDir = opfDir;
			let currentMimeType = coverMimeType;

			for (let depth = 0; depth < 3; depth++) {
				const resolvedPath = normalizeEntryPath(currentBaseDir, currentHref);
				const data = resolveEntryData(entries, currentBaseDir, currentHref);
				if (!data) return undefined;

				const manifestItem = findManifestItemByHref(
					currentHref,
					currentBaseDir,
				);
				const resolvedMimeType =
					currentMimeType ??
					manifestItem?.mediaType ??
					inferCoverMimeTypeFromPath(resolvedPath);

				if (!isContentDocumentReference(resolvedPath, resolvedMimeType)) {
					const finalMimeType = resolvedMimeType
						.toLowerCase()
						.startsWith("image/")
						? resolvedMimeType
						: inferCoverMimeTypeFromPath(resolvedPath);
					return { data, mimeType: finalMimeType };
				}

				const contentDocMarkup = strFromU8(data);
				const embeddedCoverHref =
					extractImageHrefFromContentDocument(contentDocMarkup);
				if (!embeddedCoverHref) return undefined;

				currentBaseDir = resolvedPath.includes("/")
					? resolvedPath.substring(0, resolvedPath.lastIndexOf("/") + 1)
					: "";
				currentHref = embeddedCoverHref;
				currentMimeType = findManifestItemByHref(
					embeddedCoverHref,
					currentBaseDir,
				)?.mediaType;
			}

			return undefined;
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.cover",
				cause,
			}),
	});
