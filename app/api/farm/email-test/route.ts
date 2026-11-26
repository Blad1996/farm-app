import { authorizeEmailRequest, decryptGmail, emailFailure, emailJson, EmailRequestError } from '../../../lib/farm-email-server';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const body = await emailJson(request);
    if (Object.keys(body).some(key => key !== 'companyId')) throw new EmailRequestError('Test emails can only be sent to your verified account email.');
    const { client, companyId, recipient } = await authorizeEmailRequest(request, body.companyId);
    const saved = await client.rpc('get_farm_email_secret', { p_company: companyId, p_test: true });
    if (saved.error) throw new EmailRequestError('Connect Gmail first, or wait one minute before another test.');
    const gmail = decryptGmail(saved.data as { email: string; ciphertext: string }, companyId);
    try {
      await gmail.transport.sendMail({ from: { name: 'Agro Inventory', address: gmail.email }, to: { address: recipient, name: '' },
        subject: 'Agro Inventory — connection test', text: 'Your farm notification email connection is working. Alerts will be sent only to your verified account email.' });
    } catch { throw new EmailRequestError('The test result could not be confirmed. Check your inbox before trying again.', 502); }
    finally { gmail.transport.close(); }
    return Response.json({ accepted: true, to: recipient });
  } catch (error) { return emailFailure(error); }
}
