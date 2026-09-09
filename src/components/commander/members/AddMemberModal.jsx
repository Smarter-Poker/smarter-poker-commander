/**
 * ID capture enters the app here, so both fallbacks are registered here.
 *
 * The imports are side effects on purpose: the registration has to have
 * happened before IdCaptureModal tries to read a card. Both cost nothing
 * until they are needed, because both engines load lazily and only on a
 * failure:
 *
 *   - PDF417, when the browser has no native barcode decoder (every iPad).
 *   - the card FACE, when the barcode itself will not scan, which is what a
 *     worn card does and what a room actually hits.
 */
import '../../../lib/idscan/registerPdf417Fallback';
import '../../../lib/idscan/registerFaceReader';

export { default } from '@smarter-poker/commander-shared/components/commander/members/AddMemberModal';
