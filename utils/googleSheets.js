const { google } = require('googleapis');

// Helper to get Google Sheets client if env variables are valid
const getGoogleSheetsClient = async () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!email || !privateKey) {
        return null;
    }

    const auth = new google.auth.JWT({
        email,
        key: privateKey.replace(/\\n/g, '\n').replace(/\n/g, '\n'), // strict newline normalization
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    await auth.authorize();
    return google.sheets({ version: 'v4', auth });
};

const getSheetId = () => process.env.GOOGLE_SHEET_ID;

const appendGoalToSheet = async (data) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const sheetId = getSheetId();

        if (!sheets || !sheetId) {
            console.log('Google Sheets integration mock appending:', data);
            return { success: true, mocked: true };
        }

        const type = data[1];
        const sheetName = type === 'Weekly' ? 'Sheet2' : 'Sheet1';

        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetName}!A2:I`, // Start appending from row 2
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [data]
            }
        });

        return { success: true, response: response.data };
    } catch (error) {
        console.error('Error appending to Google Sheets', error);
        throw error;
    }
};

const updateGoalInSheet = async (rowIndex, data) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const sheetId = getSheetId();

        if (!sheets || !sheetId) {
            console.log(`Google Sheets integration mock updating row ${rowIndex}:`, data);
            return { success: true, mocked: true };
        }

        const type = data[1];
        const sheetName = type === 'Weekly' ? 'Sheet2' : 'Sheet1';

        const range = `${sheetName}!A${rowIndex}:I${rowIndex}`;
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [data]
            }
        });

        return { success: true, response: response.data };
    } catch (error) {
        console.error('Error updating Google Sheets', error);
        throw error;
    }
}

const fetchGoalsFromSheet = async (userEmail, type) => {
    try {
        const sheets = await getGoogleSheetsClient();
        const sheetId = getSheetId();

        if (!sheets || !sheetId) {
            return []; // mocked response
        }

        const sheetName = type === 'Weekly' ? 'Sheet2' : 'Sheet1';

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `${sheetName}!A:Z`,
        });

        const rows = response.data.values || [];

        // Attach absolute row index (Google Sheets rows are 1-based)
        const parsedRows = rows.map((row, index) => ({
            row,
            absoluteIndex: index + 1
        }));

        // Exclude header row if present
        const dataRows = parsedRows.length > 0 && parsedRows[0].row[0] === "User ID / Email" ? parsedRows.slice(1) : parsedRows;

        let userGoals = dataRows;
        if (userEmail) {
            userGoals = userGoals.filter(r => r.row[0] === userEmail);
        }

        if (type) {
            userGoals = userGoals.filter(r => r.row[1] === type);
        }

        return userGoals.map((r, index) => ({
            email: r.row[0] || "",
            type: r.row[1] || "",
            text: r.row[2] || "",
            createdAt: r.row[3] || "",
            status: r.row[4] || "Pending",
            reflection: r.row[5] || "",
            wentWell: r.row[6] || "",
            challenges: r.row[7] || "",
            left: r.row[8] || "",
            rowIndex: r.absoluteIndex
        }));

    } catch (error) {
        console.error('Error fetching from Google Sheets', error);
        return [];
    }
};

module.exports = {
    appendGoalToSheet,
    updateGoalInSheet,
    fetchGoalsFromSheet
};