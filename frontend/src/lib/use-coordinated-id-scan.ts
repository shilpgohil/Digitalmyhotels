import { useState, useRef, useEffect, useCallback } from "react";
import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";
import { parseIdDocument, mergeOcrResults } from "@/lib/id-ocr";

export interface UseCoordinatedIdScanOptions {
  idType?: string | null;
  hotelId?: string;
  /** Timeout in milliseconds before falling back to single-sided OCR when only front is uploaded (default: 4000ms). */
  fallbackTimeoutMs?: number;
  /** Called when back face provides address fields after autofill was already accepted. */
  onAddressAutofill?: (fields: ParsedIdFields) => void;
  /** Callback for scan warnings/failures. */
  onScanError?: (msg: string) => void;
}

/**
 * Coordinated Front/Back ID Scanner Hook.
 *
 * Solves the PVC Smart Card Aadhaar problem where the Secure QR code lives
 * on the back face of the card:
 *
 * 1. When Front face is uploaded for Aadhaar:
 *    - Runs a fast QR probe (~30ms) with `qrOnly: true`.
 *    - If Front has QR (paper / e-Aadhaar): decodes 100% digitally immediately!
 *    - If Front has NO QR (PVC card): defers heavy CPU RapidOCR and waits for Back face.
 *      Stores pending front image in ref and starts a 4-second fallback timer.
 * 2. When Back face is uploaded:
 *    - Cancels fallback timer.
 *    - Scans Back face (Tier 1 QR decode takes ~40ms).
 *    - If Back has QR (PVC Aadhaar): extracts 100% digital UIDAI record with zero OCR noise!
 *      Discards pending front image so heavy RapidOCR is NEVER executed.
 *    - If Back ALSO has no QR (photocopy / card without QR on either side):
 *      Executes RapidOCR fallback on both front and back faces.
 * 3. If user only uploads Front face and never Back face:
 *    - 4-second grace period timer expires and automatically runs OCR fallback on Front face.
 * 4. Works seamlessly on both desktop web and mobile smartphones (cameras + photo galleries).
 */
export function useCoordinatedIdScan(options?: UseCoordinatedIdScanOptions) {
  const [frontResult, setFrontResult] = useState<IdOcrResult | null>(null);
  const [backResult, setBackResult] = useState<IdOcrResult | null>(null);
  const [scanningCount, setScanningCount] = useState<number>(0);
  const [autofillAccepted, setAutofillAccepted] = useState<boolean>(false);

  const pendingFrontRef = useRef<File | null>(null);
  const frontTimerRef = useRef<NodeJS.Timeout | null>(null);
  const backResultRef = useRef<IdOcrResult | null>(null);
  backResultRef.current = backResult;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearTimer = useCallback(() => {
    if (frontTimerRef.current) {
      clearTimeout(frontTimerRef.current);
      frontTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    pendingFrontRef.current = null;
    backResultRef.current = null;
    setFrontResult(null);
    setBackResult(null);
    setScanningCount(0);
    setAutofillAccepted(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const handleFrontUpload = useCallback(
    async (file: File) => {
      clearTimer();
      setFrontResult(null);
      setAutofillAccepted(false);

      const currentIdType = optionsRef.current?.idType ?? "Aadhar Card";

      // Non-Aadhaar IDs (PAN, Passport, DL, Voter ID): run standard scan immediately
      if (currentIdType && currentIdType !== "Aadhar Card") {
        setScanningCount((c) => c + 1);
        try {
          const res = await parseIdDocument(file, currentIdType, "front", {
            hotelId: optionsRef.current?.hotelId,
          });
          setFrontResult(res);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          optionsRef.current?.onScanError?.("Could not process document");
        } finally {
          setScanningCount((c) => Math.max(0, c - 1));
        }
        return;
      }

      // Aadhaar Card: Fast QR probe first (~30ms)
      setScanningCount((c) => c + 1);
      try {
        const probe = await parseIdDocument(file, "Aadhar Card", "front", {
          hotelId: optionsRef.current?.hotelId,
          qrOnly: true,
        });

        if (probe.can_autofill || probe.confidence >= 0.98 || probe.fields.name) {
          // Front has QR (e-Aadhaar / paper card)! 100% digital data
          pendingFrontRef.current = null;
          setFrontResult(probe);
          return;
        }

        // Front has NO QR (standard PVC smart card where QR is on the back).
        // Check if Back has already been decoded via QR
        const currentBack = backResultRef.current;
        if (currentBack && (currentBack.confidence >= 0.98 || currentBack.message?.includes("QR"))) {
          pendingFrontRef.current = null;
          return;
        }

        // Store pending front file and start fallback timer in case user only uploads front
        pendingFrontRef.current = file;
        const timeoutMs = optionsRef.current?.fallbackTimeoutMs ?? 4000;

        frontTimerRef.current = setTimeout(async () => {
          if (pendingFrontRef.current) {
            const frontFile = pendingFrontRef.current;
            pendingFrontRef.current = null;
            setScanningCount((c) => c + 1);
            try {
              const fullRes = await parseIdDocument(frontFile, "Aadhar Card", "front", {
                hotelId: optionsRef.current?.hotelId,
              });
              setFrontResult(fullRes);
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") return;
              optionsRef.current?.onScanError?.("Could not process document");
            } finally {
              setScanningCount((c) => Math.max(0, c - 1));
            }
          }
        }, timeoutMs);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        pendingFrontRef.current = file;
      } finally {
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [clearTimer],
  );

  const handleBackUpload = useCallback(
    async (file: File) => {
      clearTimer();
      setBackResult(null);
      setScanningCount((c) => c + 1);

      const currentIdType = optionsRef.current?.idType ?? "Aadhar Card";

      try {
        const backRes = await parseIdDocument(file, currentIdType, "back", {
          hotelId: optionsRef.current?.hotelId,
        });

        const backHasQr = backRes.confidence >= 0.98 || backRes.message?.includes("QR");

        if (backHasQr) {
          // Back HAS QR! 100% digital UIDAI record extracted.
          // Discard pending front so front never burns heavy CPU on RapidOCR!
          pendingFrontRef.current = null;
        } else if (pendingFrontRef.current) {
          // Neither face had QR! Run OCR fallback on pending front file now
          const frontFile = pendingFrontRef.current;
          pendingFrontRef.current = null;
          setScanningCount((c) => c + 1);
          parseIdDocument(frontFile, currentIdType, "front", {
            hotelId: optionsRef.current?.hotelId,
          })
            .then(setFrontResult)
            .catch(() => optionsRef.current?.onScanError?.("Could not process document"))
            .finally(() => setScanningCount((c) => Math.max(0, c - 1)));
        }

        if (autofillAccepted && optionsRef.current?.onAddressAutofill && backRes.fields) {
          optionsRef.current.onAddressAutofill(backRes.fields);
        } else if (backRes.fields.address || backRes.can_autofill) {
          setBackResult(backRes);
        } else if (!backHasQr) {
          optionsRef.current?.onScanError?.(backRes.message);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        optionsRef.current?.onScanError?.("Could not process document");
      } finally {
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [autofillAccepted, clearTimer],
  );

  const unifiedResult = mergeOcrResults(frontResult, backResult);

  return {
    frontResult,
    setFrontResult,
    backResult,
    setBackResult,
    unifiedResult,
    isScanning: scanningCount > 0,
    scanningCount,
    setScanningCount,
    autofillAccepted,
    setAutofillAccepted,
    handleFrontUpload,
    handleBackUpload,
    reset,
  };
}
