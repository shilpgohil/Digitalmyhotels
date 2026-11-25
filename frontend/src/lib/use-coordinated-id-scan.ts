import { useState, useRef, useEffect, useCallback } from "react";
import type { IdOcrResult, ParsedIdFields } from "@/lib/id-ocr";
import { parseIdDocument, mergeOcrResults } from "@/lib/id-ocr";

export interface UseCoordinatedIdScanOptions {
  idType?: string | null;
  hotelId?: string;
  /** Called when back face provides address fields after autofill was already accepted. */
  onAddressAutofill?: (fields: ParsedIdFields) => void;
  /** Called when full 12-digit Aadhaar UID is extracted after autofill was already accepted. */
  onIdNumberAutofill?: (idNumber: string) => void;
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
  isFrontScanning: boolean;
  isBackScanning: boolean;
  scanProgressText: string;
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
  const [isFrontScanning, setIsFrontScanning] = useState<boolean>(false);
  const [isBackScanning, setIsBackScanning] = useState<boolean>(false);
  const [scanProgressText, setScanProgressText] = useState<string>("");
  const [autofillAccepted, setAutofillAccepted] = useState<boolean>(false);
  const [isWaitingForBack, setIsWaitingForBack] = useState<boolean>(false);

  const pendingFrontRef = useRef<File | null>(null);
  const frontScanPromiseRef = useRef<Promise<IdOcrResult> | null>(null);
  const backResultRef = useRef<IdOcrResult | null>(null);
  backResultRef.current = backResult;
  const frontResultRef = useRef<IdOcrResult | null>(null);
  frontResultRef.current = frontResult;
  const autofillAcceptedRef = useRef(autofillAccepted);
  autofillAcceptedRef.current = autofillAccepted;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const reset = useCallback(() => {
    pendingFrontRef.current = null;
    frontScanPromiseRef.current = null;
    backResultRef.current = null;
    frontResultRef.current = null;
    setIsWaitingForBack(false);
    setFrontResult(null);
    setBackResult(null);
    setScanningCount(0);
    setIsFrontScanning(false);
    setIsBackScanning(false);
    setScanProgressText("");
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
      setIsFrontScanning(true);
      setScanProgressText("Reading front face…");

      const currentIdType = optionsRef.current?.idType ?? "Aadhar Card";

      setScanningCount((c) => c + 1);
      try {
        const res = await parseIdDocument(file, currentIdType, "front", {
          hotelId: optionsRef.current?.hotelId,
          onProgress: (_pct, status) => setScanProgressText(status),
        });
        setFrontResult(res);
        frontResultRef.current = res;

        // If autofill was already accepted and full ID was discovered (12-digit UID or non-Aadhaar), update ID
        const digitsOnly = (res.fields?.id_number || "").replace(/\D/g, "");
        const isAadhaar = !currentIdType || currentIdType === "Aadhar Card";
        if (
          res.fields?.id_number &&
          (!isAadhaar || digitsOnly.length === 12) &&
          autofillAcceptedRef.current &&
          optionsRef.current?.onIdNumberAutofill
        ) {
          optionsRef.current.onIdNumberAutofill(res.fields.id_number);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        optionsRef.current?.onScanError?.("Could not process front document");
      } finally {
        setIsFrontScanning(false);
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [],
  );

  const handleBackUpload = useCallback(
    async (file: File) => {
      setIsWaitingForBack(false);
      setBackResult(null);
      setIsBackScanning(true);
      setScanProgressText("Reading back face and extracting address…");
      setScanningCount((c) => c + 1);

      const currentIdType = optionsRef.current?.idType ?? "Aadhar Card";

      try {
        const backRes = await parseIdDocument(file, currentIdType, "back", {
          hotelId: optionsRef.current?.hotelId,
          onProgress: (_pct, status) => setScanProgressText(status),
        });
        setBackResult(backRes);
        backResultRef.current = backRes;

        // If autofill was already accepted (e.g. front was accepted earlier),
        // or caller provided onAddressAutofill, trigger autofill of address and location!
        if (optionsRef.current?.onAddressAutofill && backRes.fields) {
          optionsRef.current.onAddressAutofill(backRes.fields);
        }

        // If back face extracted full ID (e.g. Aadhaar back QR 12 digits or DL back QR DLNO), update ID number
        const backDigits = (backRes.fields?.id_number || "").replace(/\D/g, "");
        const isAadhaar = !currentIdType || currentIdType === "Aadhar Card";
        if (
          backRes.fields?.id_number &&
          (!isAadhaar || backDigits.length === 12) &&
          optionsRef.current?.onIdNumberAutofill
        ) {
          optionsRef.current.onIdNumberAutofill(backRes.fields.id_number);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        optionsRef.current?.onScanError?.("Could not process back document");
      } finally {
        setIsBackScanning(false);
        setScanningCount((c) => Math.max(0, c - 1));
      }
    },
    [],
  );

  const triggerFrontOcrFallback = useCallback(async () => {
    setIsWaitingForBack(false);
    if (!pendingFrontRef.current && frontResultRef.current) {
      // Front was already pre-scanned in the background! Clearing isWaitingForBack reveals unifiedResult.
      return;
    }
    if (frontScanPromiseRef.current) {
      setScanningCount((c) => c + 1);
      setIsFrontScanning(true);
      try {
        const fRes = await frontScanPromiseRef.current;
        if (fRes) {
          setFrontResult(fRes);
          frontResultRef.current = fRes;
          const fId = (fRes.fields?.id_number || "").trim();
          const fDigits = fId.replace(/\D/g, "");
          const isAadhaar = (fRes.fields?.id_type_detected || optionsRef.current?.idType || "Aadhar Card") === "Aadhar Card";
          if (
            fId.length >= 4 &&
            (!isAadhaar || fDigits.length === 12) &&
            autofillAcceptedRef.current &&
            optionsRef.current?.onIdNumberAutofill
          ) {
            optionsRef.current.onIdNumberAutofill(fId);
          }
        }
      } finally {
        setIsFrontScanning(false);
        setScanningCount((c) => Math.max(0, c - 1));
      }
      return;
    }
    if (!pendingFrontRef.current) return;
    const frontFile = pendingFrontRef.current;
    pendingFrontRef.current = null;
    setScanningCount((c) => c + 1);
    setIsFrontScanning(true);
    try {
      const fullRes = await parseIdDocument(
        frontFile,
        optionsRef.current?.idType ?? "Aadhar Card",
        "front",
        {
          hotelId: optionsRef.current?.hotelId,
          onProgress: (_pct, status) => setScanProgressText(status),
        },
      );
      setFrontResult(fullRes);
      frontResultRef.current = fullRes;
      const fId = (fullRes.fields?.id_number || "").trim();
      const fDigits = fId.replace(/\D/g, "");
      const isAadhaar = (fullRes.fields?.id_type_detected || optionsRef.current?.idType || "Aadhar Card") === "Aadhar Card";
      if (
        fId.length >= 4 &&
        (!isAadhaar || fDigits.length === 12) &&
        autofillAcceptedRef.current &&
        optionsRef.current?.onIdNumberAutofill
      ) {
        optionsRef.current.onIdNumberAutofill(fId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      optionsRef.current?.onScanError?.("Could not process document");
    } finally {
      setIsFrontScanning(false);
      setScanningCount((c) => Math.max(0, c - 1));
    }
  }, []);

  const effectiveFront = frontResult ?? frontResultRef.current;
  const effectiveBack = backResult ?? backResultRef.current;
  const rawUnifiedResult = mergeOcrResults(effectiveFront, effectiveBack);
  // While waiting for Back face to scan QR code on PVC cards, do NOT expose a premature partial OCR result
  // from Front alone, which would display an OCR banner before the staff uploads the Back QR card.
  const unifiedResult = isWaitingForBack ? null : rawUnifiedResult;

  return {
    frontResult,
    setFrontResult,
    backResult,
    setBackResult,
    unifiedResult,
    isScanning: scanningCount > 0,
    isFrontScanning,
    isBackScanning,
    scanProgressText,
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
