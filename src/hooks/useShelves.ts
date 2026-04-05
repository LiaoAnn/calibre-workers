import { useQuery } from "@tanstack/react-query";
import { listShelvesServerFn } from "#/server/shelves";

export const shelvesQueryKeys = {
	all: ["shelves"] as const,
} as const;

export function useShelves(
	initialData?: Awaited<ReturnType<typeof listShelvesServerFn>>,
) {
	return useQuery({
		queryKey: shelvesQueryKeys.all,
		queryFn: () => listShelvesServerFn(),
		...(initialData ? { initialData } : {}),
	});
}
