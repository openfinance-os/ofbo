import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import process from 'node:process'

const resources = process.env.PINT_AE_RESOURCES_DIR
const saxon = process.env.SAXON_HE_JAR
const documents = process.argv.slice(2)

if (!resources || !saxon || documents.length === 0) {
  console.error('Usage: PINT_AE_RESOURCES_DIR=/path/to/v1.0.3 SAXON_HE_JAR=/path/to/saxon.jar pnpm --filter @ofbo/billing validate:pint-ae -- invoice.xml [credit-note.xml]')
  process.exit(2)
}
if (!existsSync(saxon)) throw new Error(`Saxon HE jar not found: ${saxon}`)

for (const document of documents) {
  const source = readFileSync(document, 'utf8')
  const transaction = source.includes('<CreditNote ') ? 'trn-creditnote' : source.includes('<Invoice ') ? 'trn-invoice' : null
  if (!transaction) throw new Error(`${document}: expected a UBL Invoice or CreditNote root`)
  for (const ruleset of ['PINT-UBL-validation-preprocessed', 'PINT-jurisdiction-aligned-rules']) {
    const stylesheet = `${resources}/${transaction}/schematron/${ruleset}.xslt`
    if (!existsSync(stylesheet)) throw new Error(`official PINT AE artifact not found: ${stylesheet}`)
    const result = spawnSync('java', [
      '-cp', saxon,
      'net.sf.saxon.Transform',
      `-s:${document}`,
      `-xsl:${stylesheet}`
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`${document}: ${ruleset} could not execute\n${result.stderr}`)
    if (result.stdout.includes('<svrl:failed-assert') || result.stdout.includes('<svrl:successful-report')) {
      const ids = [...result.stdout.matchAll(/(?:failed-assert|successful-report)[^>]*id="([^"]+)"/g)].map((match) => match[1])
      throw new Error(`${document}: ${ruleset} failed: ${ids.join(', ') || 'inspect SVRL output'}`)
    }
    console.log(`PASS ${document} — ${ruleset}`)
  }
}
