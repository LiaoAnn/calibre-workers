import "@tanstack/react-start/server-only";

import { Effect } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { ParseError } from "#/lib/errors";

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

			const authors = extractAllTagContents(opfXml, "creator");
			const tags = extractAllTagContents(opfXml, "subject");
			const identifiers = extractIdentifiers(opfXml);

			// Calibre series: <meta name="calibre:series" content="..." />
			let series: string | undefined;
			let seriesIndex: number | undefined;
			const calibreSeriesMeta =
				/<meta\b[^>]*\bname="calibre:series"\b[^>]*>/i.exec(opfXml);
			if (calibreSeriesMeta) {
				const c = /content="([^"]+)"/.exec(calibreSeriesMeta[0]);
				if (c?.[1]) series = decodeXmlEntities(c[1]);
			}
			// EPUB 3: <meta property="belongs-to-collection">Series</meta>
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
			// EPUB 3: <meta property="group-position">1</meta>
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
			} satisfies EpubMetadata;
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
