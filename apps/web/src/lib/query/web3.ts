import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { web3 } from "@/lib/api/web3";
import { isApiError } from "@/lib/api/errors";

export const web3Keys = {
  anchor: (id: string) => ["anchor", id] as const,
  verify: (id: string) => ["public-verify", id] as const,
};

export function useAnchor(reportId: string) {
  return useQuery({ queryKey: web3Keys.anchor(reportId), queryFn: () => web3.anchor(reportId) });
}

export function useCreateAnchor(reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => web3.createAnchor(reportId),
    onSuccess: (data) => {
      qc.setQueryData(web3Keys.anchor(reportId), data);
      void qc.invalidateQueries({ queryKey: web3Keys.verify(reportId) });
    },
  });
}

/** Never retried: a 404 (not anchored) or 503 (chain unavailable) is an answer, not a blip. */
export function usePublicVerify(reportId: string, enabled = true) {
  return useQuery({
    queryKey: web3Keys.verify(reportId),
    queryFn: () => web3.verify(reportId),
    enabled,
    retry: (count, err) => !(isApiError(err) && (err.status === 404 || err.status === 503)) && count < 1,
  });
}

export function useVerifyPayload(reportId: string) {
  return useMutation({ mutationFn: (payload: Record<string, unknown>) => web3.verifyPayload(reportId, payload) });
}
