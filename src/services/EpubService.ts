import "@tanstack/react-start/server-only";

import { Effect } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { ParseError } from "#/lib/errors";

export interface EpubMetadata {
	title?: string;
	author?: string;
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
				return {} satisfies EpubMetadata;
			}

			const opfXml = readZipText(entries, opfPath);
			if (!opfXml) {
				return {} satisfies EpubMetadata;
			}

			return {
				title: extractTagContent(opfXml, "title"),
				author: extractTagContent(opfXml, "creator"),
			} satisfies EpubMetadata;
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.metadata",
				cause,
			}),
	});

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

			// EPUB 3: <item properties="cover-image" .../>
			const epub3Match =
				/<item\b[^>]*\bproperties="[^"]*cover-image[^"]*"[^>]*>/i.exec(opfXml);
			if (epub3Match) {
				const hrefMatch = /href="([^"]+)"/.exec(epub3Match[0]);
				const typeMatch = /media-type="([^"]+)"/.exec(epub3Match[0]);
				if (hrefMatch?.[1]) {
					coverHref = hrefMatch[1];
					coverMimeType = typeMatch?.[1];
				}
			}

			// EPUB 2/3: <item id="cover-image" .../>
			if (!coverHref) {
				const idMatch = /<item\b[^>]*\bid="cover-image"[^>]*/i.exec(opfXml);
				if (idMatch) {
					const hrefMatch = /href="([^"]+)"/.exec(idMatch[0]);
					const typeMatch = /media-type="([^"]+)"/.exec(idMatch[0]);
					if (hrefMatch?.[1]) {
						coverHref = hrefMatch[1];
						coverMimeType = typeMatch?.[1];
					}
				}
			}

			// EPUB 2 fallback: <meta name="cover" content="<item-id>"/>
			if (!coverHref) {
				const metaMatch =
					/<meta\b[^>]*\bname="cover"\b[^>]*\bcontent="([^"]+)"[^>]*/i.exec(
						opfXml,
					) ??
					/<meta\b[^>]*\bcontent="([^"]+)"[^>]*\bname="cover"[^>]*/i.exec(
						opfXml,
					);
				if (metaMatch?.[1]) {
					const coverId = metaMatch[1];
					const escapedId = coverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const itemMatch = new RegExp(
						`<item\\b[^>]*\\bid="${escapedId}"[^>]*>`,
						"i",
					).exec(opfXml);
					if (itemMatch) {
						const hrefMatch = /href="([^"]+)"/.exec(itemMatch[0]);
						const typeMatch = /media-type="([^"]+)"/.exec(itemMatch[0]);
						if (hrefMatch?.[1]) {
							coverHref = hrefMatch[1];
							coverMimeType = typeMatch?.[1];
						}
					}
				}
			}

			if (!coverHref) return undefined;

			const resolvedPath = opfDir + coverHref;
			const data =
				entries[resolvedPath] ?? entries[resolvedPath.replace(/^\.\//, "")];
			if (!data) return undefined;

			const mimeType =
				coverMimeType ??
				(coverHref.endsWith(".png")
					? "image/png"
					: coverHref.endsWith(".gif")
						? "image/gif"
						: coverHref.endsWith(".webp")
							? "image/webp"
							: "image/jpeg");

			return { data, mimeType };
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.cover",
				cause,
			}),
	});
