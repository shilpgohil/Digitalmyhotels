import { useState, useRef, useEffect, useCallback } from "react";
import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";
import { parseIdDocument, mergeOcrResults } from "@/lib/id-ocr";

export interface UseCoordinatedIdScanOptions {
  idType?: string | null;
  hotelId?: string;
  /** Called when back face provides address fields after autofill was already accepted. */
  onAddressAutofill?: (fields: ParsedIdFields) => void;
  /** Callback for scan warnings/failures. */
  onScanError?: (msg: string) => void;
}

export interface UseCoordinatedIdScanReturn {
  frontResult: IdOcrResult | null;
  setFrontResult: React.Dispatch<React.SetStateAction<IdOcrResult | null>>;
  backResult: IdOcrResult | null;
  setBackResult: React.Dispatch<React.SetStateAction<IdOcrResult | null>>;
  unifiedResult: IdOcrResult | null;
  isScanning: boolean;
  scanningCount: number;
  setScanningCount: React.Dispatch<React.SetStateAction<number>>;
  autofillAccepted: boolean;
  setAutofillAccepted: React.Dispatch<React.SetStateAction<boolean>>;
  isWaitingForBack: boolean;
  triggerFrontOcrFallback: () => Promise<void>;
  handleFrontUpload: (file: File) => Promise<void>;
  handleBackUpload: (file: File) => Promise<void>;
  reset: () => void;
}

/**
 * Coordinated Front/Back ID Scanner Hook.
 *
 * Guarantees that QR code extraction ALWAYS takes absolute priority over OCR:
 *
 * 1. When Front face is uploaded for Aadhaar:
 *    - Runs a fast QR probe (~30ms) with `qrOnly: true`.
 *    - If Front has QR (e-Aadhaar / paper card): extracts 100% digital data immediately!
 *    - If Front has NO QR (standard PVC smart card): defers heavy CPU RapidOCR and waits for Back face.
 *      Stores pending front image in ref and marks `isWaitingForBack = true`.
 *      ZERO OCR is executed on front. No premature timers!
 *
 * 2. When Back face is uploaded for Aadhaar:
 *    - Probes Back face with `qrOnly: true` (~40ms).
 *    - If Back has QR (standard PVC smart card): extracts 100% digital UIDAI record with zero OCR noise!
 *      Discards pending front image so heavy RapidOCR is NEVER executed on either face.
 *    - If Back ALSO has NO QR (photocopy / card without QR on either side):
 *      Executes RapidOCR fallback on both front and back faces, then merges results.
 *
 * 3. Manual Front-Only Override:
 *    - If staff only has a single-sided front card and will not upload the back face,
 *      `triggerFrontOcrFallback()` triggers OCR on the front image on demand.
 */
export function useCoordinatedIdScan(
  options?: UseCoordinatedIdScanOptions,
): UseCoordinatedIdScanReturn {
  const [frontResult, setFrontResult] = useState<IdOcrResult | null>(null);
  const [backResult, setBackResult] = useState<IdOcrResult | null>(null);
  const [scanningCount, setScanningCount] = useState<number>(0);
  const [autofillAccepted, setAutofillAccepted] = useState<boolean>(false);
  const [isWaitingForBack, setIsWaitingForBack] = useState<boolean>(false);

  const pendingFrontRef = useRef<File | null>(null);
  const backResultRef = useRef<IdOcrResult | null>(null);
  backResultRef.current = backResult;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reset = useCallback(() => {
    pendingFrontRef.current = null;
    backResultRef.current = null;
    setIsWaitingForBack(false);
    setFrontResult(null);
    setBackResult(null);
    setScanningCount(0);
    setAutofillAccepted(false);
  }, []);

  // When idType changes (e.g. user toggles from Aadhaar to Passport), reset pending state
  const prevIdTypeRef = useRef(options?.idType);
  useEffect(() => {
    if (options?.idType !== prevIdTypeRef.current) {
      prevIdTypeRef.current = options?.idType;
      reset();
    }
  }, [options?.idType, reset]);

  const handleFrontUpload = useCallback(
    async (file: File) => {
      pendingFrontRef.current = null;
      setIsWaitingForBack(false);
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

        const isQr = probe.source === "qr" || probe.confidence >= 0.98 || probe.fields.name;
        if (probe.can_autofill || isQr) {
          // Front has QR (e-Aadhaar / paper card)! 100% digital data
          pendingFrontRef.current = null;
          setIsWaitingForBack(false);
          setFrontResult(probe);
          return;
        }

        // Front has NO QR (standard PVC smart card where QR is on the back face).
        // Check if Back has already been decoded via QR
        const currentBack = backResultRef.current;
        if (
          currentBack &&
          (currentBack.source === "qr" ||
            currentBack.confidence >= 0.98 ||
            currentBack.message?.includes("QR"))
        ) {
          pendingFrontRef.current = null;
          setIsWaitingForBack(false);
          return;
        }

        // Store pending front file and wait for Back face upload.
        // DO NOT start any timer! DO NOT run RapidOCR!
        pendingFrontRef.current = file;
        setIsWaitingForBack(true);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        pendingFrontRef.current = file;
        setIsWaitingForBack(true);
      } finally {
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [],
  );

  const handleBackUpload = useCallback(
    async (file: File) => {
      setIsWaitingForBack(false);
      setBackResult(null);
      setScanningCount((c) => c + 1);

      const currentIdType = optionsRef.current?.idType ?? "Aadhar Card";

      // Non-Aadhaar IDs: run standard back scan
      if (currentIdType && currentIdType !== "Aadhar Card") {
        try {
          const backRes = await parseIdDocument(file, currentIdType, "back", {
            hotelId: optionsRef.current?.hotelId,
          });
          setBackResult(backRes);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          optionsRef.current?.onScanError?.("Could not process document");
        } finally {
          setScanningCount((c) => Math.max(0, c - 1));
        }
        return;
      }

      // Aadhaar Card: Probe Back face with qrOnly: true FIRST!
      try {
        const backProbe = await parseIdDocument(file, "Aadhar Card", "back", {
          hotelId: optionsRef.current?.hotelId,
          qrOnly: true,
        });

        const backHasQr =
          backProbe.source === "qr" ||
          backProbe.confidence >= 0.98 ||
          backProbe.message?.includes("QR") ||
          Boolean(backProbe.fields.name || backProbe.fields.id_number || backProbe.fields.address);

        if (backHasQr && backProbe.can_autofill) {
          // Back HAS Secure QR code (standard PVC card)!
          // 100% digital UIDAI record extracted!
          // Discard pending front so front NEVER burns heavy CPU on RapidOCR!
          pendingFrontRef.current = null;
          setBackResult(backProbe);

          if (autofillAccepted && optionsRef.current?.onAddressAutofill && backProbe.fields) {
            optionsRef.current.onAddressAutofill(backProbe.fields);
          }
          return;
        }

        // Back does NOT have QR!
        // At this stage, Front has no QR and Back has no QR (photocopy / card without QR on either side).
        // Only NOW do we fall back to RapidOCR!
        const frontFile = pendingFrontRef.current;
        pendingFrontRef.current = null;

        // If front was uploaded, run OCR on front first
        if (frontFile) {
          setScanningCount((c) => c + 1);
          try {
            const fRes = await parseIdDocument(frontFile, "Aadhar Card", "front", {
              hotelId: optionsRef.current?.hotelId,
            });
            setFrontResult(fRes);
          } catch {
            optionsRef.current?.onScanError?.("Could not process document");
          } finally {
            setScanningCount((c) => Math.max(0, c - 1));
          }
        }

        // Run OCR on back
        const backOcr = await parseIdDocument(file, "Aadhar Card", "back", {
          hotelId: optionsRef.current?.hotelId,
        });
        setBackResult(backOcr);

        if (autofillAccepted && optionsRef.current?.onAddressAutofill && backOcr.fields) {
          optionsRef.current.onAddressAutofill(backOcr.fields);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        optionsRef.current?.onScanError?.("Could not process document");
      } finally {
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [autofillAccepted],
  );

  const triggerFrontOcrFallback = useCallback(async () => {
    if (!pendingFrontRef.current) return;
    const frontFile = pendingFrontRef.current;
    pendingFrontRef.current = null;
    setIsWaitingForBack(false);
    setScanningCount((c) => c + 1);
    try {
      const fullRes = await parseIdDocument(
        frontFile,
        optionsRef.current?.idType ?? "Aadhar Card",
        "front",
        {
          hotelId: optionsRef.current?.hotelId,
        },
      );
      setFrontResult(fullRes);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      optionsRef.current?.onScanError?.("Could not process document");
    } finally {
      setScanningCount((c) => Math.max(0, c - 1));
    }
  }, []);

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
    isWaitingForBack,
    triggerFrontOcrFallback,
    handleFrontUpload,
    handleBackUpload,
    reset,
  };
}
