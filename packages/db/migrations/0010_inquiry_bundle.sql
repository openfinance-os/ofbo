-- BACKOFFICE-23: the per-PSU CBUAE inquiry bundle is generated into the
-- compliance_report row as structured content with line-level integrity hashes.
-- (In the regulated profile the rendered PDF/XLSX lands in object storage at
-- storage_path; the structured content + hashes are the evidence-grade record.)
-- jsonb, nullable — existing report rows (periodic reports) carry no bundle.
ALTER TABLE compliance_report ADD COLUMN IF NOT EXISTS content jsonb;
