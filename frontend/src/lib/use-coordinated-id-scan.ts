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

        const isQr = probe.source === "qr" || Boolean(probe.message?.includes("QR"));
        if (probe.can_autofill || isQr) {
          // Front has QR (e-Aadhaar / paper card)! 100% digital data
          setFrontResult(probe);

          // Check if Front QR already provided a complete street address + pincode
          const frontHasAddress = Boolean(probe.fields.address && probe.fields.pincode);
          if (frontHasAddress) {
            pendingFrontRef.current = null;
            setIsWaitingForBack(false);
            return;
          }

          // Front has digital QR (Name, Gender, DOB, UID), but the paper card carries the address on the back face.
          // Keep pendingFrontRef null (no need to OCR front), and set isWaitingForBack = true to capture the back address.
          pendingFrontRef.current = null;
          setIsWaitingForBack(true);
          return;
        }

        // Front has NO QR (standard PVC smart card where QR is on the back face).
        // Check if Back has already been decoded via QR
        const currentBack = backResultRef.current;
        if (
          currentBack &&
          (currentBack.source === "qr" || Boolean(currentBack.message?.includes("QR")))
        ) {
          pendingFrontRef.current = null;
          setIsWaitingForBack(false);

          // Check if Back QR already had all 12 digits for Aadhaar Number
          const backUidDigits = (currentBack.fields.id_number || "").replace(/\D/g, "");
          if (backUidDigits.length !== 12) {
            // Front face carries the printed 12-digit UID! Scan Front to recover all 12 digits.
            try {
              const fRes = await parseIdDocument(file, "Aadhar Card", "front", {
                hotelId: optionsRef.current?.hotelId,
                qrOnly: false,
              });
              setFrontResult(fRes);
              const fDigits = (fRes.fields?.id_number || "").replace(/\D/g, "");
              if (
                fDigits.length === 12 &&
                autofillAcceptedRef.current &&
                optionsRef.current?.onIdNumberAutofill
              ) {
                optionsRef.current.onIdNumberAutofill(fRes.fields.id_number!);
              }
            } catch {
              // Non-fatal
            }
          }
          return;
        }

        // Store pending front file and wait for Back face upload.
        pendingFrontRef.current = file;
        setIsWaitingForBack(true);

        // Pre-scan Front face right away with fast server OCR to extract the 12-digit UID and Name!
        // When Back is uploaded later, Back's digital QR data merges instantly with Front's 12-digit UID in 0ms!
        const frontScanPromise = parseIdDocument(file, "Aadhar Card", "front", {
          hotelId: optionsRef.current?.hotelId,
          qrOnly: false,
        });
        frontScanPromiseRef.current = frontScanPromise;
        try {
          const fRes = await frontScanPromise;
          if (fRes.fields?.id_number || fRes.fields?.name) {
            setFrontResult(fRes);
            const fDigits = (fRes.fields?.id_number || "").replace(/\D/g, "");
            if (
              fDigits.length === 12 &&
              autofillAcceptedRef.current &&
              optionsRef.current?.onIdNumberAutofill
            ) {
              optionsRef.current.onIdNumberAutofill(fRes.fields.id_number!);
            }
          }
        } catch {
          // Non-fatal
        }
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
          Boolean(backProbe.message?.includes("QR")) ||
          Boolean(backProbe.fields.name && (backProbe.fields.id_number || backProbe.fields.address));

        if (backHasQr && backProbe.can_autofill) {
          // Back HAS Secure QR code (standard PVC card)!
          // 100% digital UIDAI record extracted!
          const backUidDigits = (backProbe.fields.id_number || "").replace(/\D/g, "");
          const backHas12Digits = backUidDigits.length === 12;

          let currentFront = frontResultRef.current;
          let frontUidDigits = (currentFront?.fields?.id_number || "").replace(/\D/g, "");
          let frontHas12Digits = frontUidDigits.length === 12;

          // If Back only has 4 digits, but Front was uploaded, AWAIT Front's 12-digit UID scan BEFORE showing banner!
          if (!backHas12Digits && !frontHas12Digits && pendingFrontRef.current) {
            try {
              const fRes = frontScanPromiseRef.current
                ? await frontScanPromiseRef.current
                : await parseIdDocument(pendingFrontRef.current, "Aadhar Card", "front", {
                    hotelId: optionsRef.current?.hotelId,
                    qrOnly: false,
                  });
              if (fRes && fRes.fields) {
                // When Back has digital QR, Back's digital Name/DOB/Gender/Address 100% WINS!
                // Front OCR is ONLY used to supply the 12-digit UID!
                const sanitizedFront: IdOcrResult = {
                  ...fRes,
                  fields: {
                    ...fRes.fields,
                    name: backProbe.fields.name || fRes.fields.name,
                    date_of_birth: backProbe.fields.date_of_birth || fRes.fields.date_of_birth,
                    gender: backProbe.fields.gender || fRes.fields.gender,
                  },
                };
                setFrontResult(sanitizedFront);
                currentFront = sanitizedFront;
                frontUidDigits = (fRes.fields?.id_number || "").replace(/\D/g, "");
                frontHas12Digits = frontUidDigits.length === 12;
              }
            } catch {
              // Non-fatal
            }
          } else if (currentFront && currentFront.fields && backProbe.fields.name) {
            // Front was already pre-scanned. Sanitize it so Back QR's digital Name/DOB/Gender wins!
            setFrontResult({
              ...currentFront,
              fields: {
                ...currentFront.fields,
                name: backProbe.fields.name,
                date_of_birth: backProbe.fields.date_of_birth || currentFront.fields.date_of_birth,
                gender: backProbe.fields.gender || currentFront.fields.gender,
              },
            });
          }

          // Set back result and reveal unified banner with all 12 digits
          setBackResult(backProbe);
          setIsWaitingForBack(false);
          pendingFrontRef.current = null;
          frontScanPromiseRef.current = null;

          if (autofillAcceptedRef.current && optionsRef.current?.onAddressAutofill && backProbe.fields) {
            optionsRef.current.onAddressAutofill(backProbe.fields);
          }
          if (autofillAcceptedRef.current && optionsRef.current?.onIdNumberAutofill) {
            const resolvedUid = frontHas12Digits
              ? (currentFront?.fields?.id_number || "")
              : (backHas12Digits ? (backProbe.fields.id_number || "") : "");
            const d = resolvedUid.replace(/\D/g, "");
            if (d.length === 12) {
              optionsRef.current.onIdNumberAutofill(resolvedUid);
            }
          }
          return;
        }

        // Back does NOT have QR!
        // Check if Front card already produced a verified QR result (e.g. e-Aadhaar / paper card):
        const currentFront = frontResultRef.current;
        const frontHasQr =
          currentFront &&
          (currentFront.source === "qr" || Boolean(currentFront.message?.includes("QR")));

        if (frontHasQr) {
          pendingFrontRef.current = null;
          setIsWaitingForBack(false);

          // If Front had QR but lacks complete street address or pincode,
          // scan Back face with server OCR to extract the printed address block!
          const frontHasAddress = Boolean(currentFront.fields.address && currentFront.fields.pincode);
          if (!frontHasAddress) {
            try {
              const backOcr = await parseIdDocument(file, "Aadhar Card", "back", {
                hotelId: optionsRef.current?.hotelId,
                qrOnly: false,
              });
              if (backOcr.can_autofill || backOcr.fields.address || backOcr.fields.pincode) {
                setBackResult(backOcr);
                if (autofillAcceptedRef.current && optionsRef.current?.onAddressAutofill && backOcr.fields) {
                  optionsRef.current.onAddressAutofill(backOcr.fields);
                }
              }
            } catch {
              // Non-fatal fallback
            }
          }
          return;
        }

        // Back does NOT have QR AND Front does NOT have QR!
        // At this stage, Front has no QR and Back has no QR (photocopy / card without QR on either side).
        // Only NOW do we fall back to RapidOCR!
        const frontFile = pendingFrontRef.current;
        pendingFrontRef.current = null;
        setIsWaitingForBack(false);

        // If front was uploaded and hasn't been scanned yet, run OCR on front
        if (frontFile && !frontResultRef.current) {
          setScanningCount((c) => c + 1);
          try {
            const fRes = await parseIdDocument(frontFile, "Aadhar Card", "front", {
              hotelId: optionsRef.current?.hotelId,
              qrOnly: false,
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
          qrOnly: false,
        });
        setBackResult(backOcr);

        if (autofillAcceptedRef.current && optionsRef.current?.onAddressAutofill && backOcr.fields) {
          optionsRef.current.onAddressAutofill(backOcr.fields);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        optionsRef.current?.onScanError?.("Could not process document");
      } finally {
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
    if (!pendingFrontRef.current) return;
    const frontFile = pendingFrontRef.current;
    pendingFrontRef.current = null;
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
      const fDigits = (fullRes.fields?.id_number || "").replace(/\D/g, "");
      if (
        fDigits.length === 12 &&
        autofillAcceptedRef.current &&
        optionsRef.current?.onIdNumberAutofill
      ) {
        optionsRef.current.onIdNumberAutofill(fullRes.fields.id_number!);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      optionsRef.current?.onScanError?.("Could not process document");
    } finally {
      setScanningCount((c) => Math.max(0, c - 1));
    }
  }, []);

  const rawUnifiedResult = mergeOcrResults(frontResult, backResult);
  // While waiting for Back face to scan QR code on PVC cards, do NOT expose a premature partial OCR result
  // from Front alone, which would display an OCR banner before the staff uploads the Back QR card.
  const unifiedResult =
    isWaitingForBack && !(frontResult?.source === "qr" || frontResult?.confidence === 1.0)
      ? null
      : rawUnifiedResult;

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
