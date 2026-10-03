import { z } from "zod";

/**
 * Document layouts the importer understands. The id names the issuer and
 * the layout, so a broker that changes its note gets a new id instead of a
 * silently different reading of the old one.
 */
export const BROKER_NOTE_FORMATS = [
  "inter-dtvm-sinacor",
  "inter-dtvm-web",
  "apex-confirm",
  "drivewealth-confirm",
] as const;
export const brokerNoteFormatSchema = z.enum(BROKER_NOTE_FORMATS);
export type BrokerNoteFormat = z.infer<typeof brokerNoteFormatSchema>;

export const BROKER_NOTE_FORMAT_LABELS: Record<BrokerNoteFormat, string> = {
  "inter-dtvm-sinacor": "Inter DTVM",
  "inter-dtvm-web": "Inter DTVM",
  "apex-confirm": "Apex Clearing",
  "drivewealth-confirm": "DriveWealth",
};

/** The note a transaction was imported from, shown in the trade log. */
export const transactionBrokerNoteSchema = z.object({
  id: z.string(),
  format: brokerNoteFormatSchema,
  noteNumber: z.string().nullable(),
});

export type TransactionBrokerNote = z.infer<typeof transactionBrokerNoteSchema>;
