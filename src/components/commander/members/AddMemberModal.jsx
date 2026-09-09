/**
 * ID capture enters the app here, so the PDF417 fallback is registered here.
 *
 * The import is a side effect on purpose: an iPad has no native barcode
 * decoder, and the registration has to have happened before IdCaptureModal
 * tries to read one. It costs nothing on a browser that can decode natively,
 * because the decoder itself is loaded lazily and only on failure to find one.
 */
import '../../../lib/idscan/registerPdf417Fallback';

export { default } from '@smarter-poker/commander-shared/components/commander/members/AddMemberModal';
