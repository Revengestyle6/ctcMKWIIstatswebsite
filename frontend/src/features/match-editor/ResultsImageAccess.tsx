import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, fetchJson } from "../../api";
import { resultsImportPath } from "./raceResultsImage";

type Access = "checking" | "ready" | "sign-in" | "unavailable" | "failed";

export function useResultsImageAccess(): Access {
  const accessRequest = useRef<Promise<{ enabled: boolean }>>(null);
  const [access, setAccess] = useState<Access>("checking");
  useEffect(() => {
    let current = true;
    accessRequest.current ??= fetchJson<{ enabled: boolean }>(resultsImportPath);
    void accessRequest.current
      .then(({ enabled }) => {
        if (current) setAccess(enabled ? "ready" : "unavailable");
      })
      .catch((failure: unknown) => {
        if (!current) return;
        if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
          setAccess("sign-in");
        } else {
          setAccess(
            failure instanceof ApiError && failure.status === 404 ? "unavailable" : "failed"
          );
        }
      });
    return () => {
      current = false;
    };
  }, []);

  return access;
}

export function ResultsImageAccessMessage({ access }: { access: Access }) {
  return (
    <>
      {access === "checking" && (
        <p className="mt-3 text-sm" role="status">
          Checking image extraction…
        </p>
      )}
      {access === "sign-in" && (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          Image extraction requires administrator access.{" "}
          <Link to="/admin/access" className="text-blue-300 underline">
            Administrator sign-in
          </Link>
        </p>
      )}
      {access === "unavailable" && (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          Image extraction is unavailable on this server.
        </p>
      )}
      {access === "failed" && (
        <p className="mt-3 text-sm text-amber-200" role="alert">
          Could not check image extraction. Reopen image extraction to try again.
        </p>
      )}
    </>
  );
}

export const imageDisclosure =
  "The image and roster Mii names are sent to Google Gemini. Use images without personal or confidential information.";
