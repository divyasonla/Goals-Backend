const { appendGoalToSheet, fetchGoalsFromSheet, updateGoalInSheet } = require('../utils/googleSheets');
const Report = require('../models/Report');
const { GoogleGenAI } = require('@google/genai');

const dailyGoalsHandler = async (req, res) => {
    const { action, email, ...data } = req.body;

    try {
        if (action === 'fetch') {
            const goals = await fetchGoalsFromSheet(email, 'Daily');

            const formattedGoals = goals.map((g) => ({
                rowIndex: g.rowIndex,
                id: `daily_${g.rowIndex}`,
                email: g.email || email,
                dailyGoal: g.text,
                date: g.createdAt,
                status: g.status,
                reflection: g.reflection,
                wentWell: g.wentWell,
                challenges: g.challenges,
                left: g.left
            }));

            return res.json({ goals: formattedGoals });
        }

        if (action === 'add') {
            const dateStr = new Date().toISOString().split("T")[0];
            const goalData = [
                email,
                'Daily',
                data.dailyGoal,
                dateStr,
                data.status || 'Pending',
                data.reflection || '',
                data.wentWell || '',
                data.challenges || '',
                data.left || '',
            ];
            await appendGoalToSheet(goalData);

            return res.json({ message: "Goal added successfully", goal: { email, dailyGoal: data.dailyGoal, date: dateStr, status: data.status || 'Pending' } });
        }

        if (action === 'update') {
            const rowIndex = data.rowIndex;
            if (!rowIndex) return res.status(400).json({ error: "Missing rowIndex for update" });

            const goalData = [
                email,
                'Daily',
                data.dailyGoal,
                data.date,
                data.status || 'Pending',
                data.reflection || '',
                data.wentWell || '',
                data.challenges || '',
                data.left || ''
            ];
            await updateGoalInSheet(rowIndex, goalData);
            return res.json({ message: "Goal updated successfully" });
        }

        return res.status(400).json({ error: "Invalid action" });
    } catch (error) {
        console.error("Daily goals error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

const weeklyGoalsHandler = async (req, res) => {
    const { action, email, ...data } = req.body;

    try {
        if (action === 'fetch') {
            const goals = await fetchGoalsFromSheet(email, 'Weekly');

            const formattedGoals = goals.map((g) => ({
                rowIndex: g.rowIndex,
                id: `weekly_${g.rowIndex}`,
                email: g.email || email,
                weeklyGoal: g.text,
                week: g.createdAt,
                status: g.status,
                reflection: g.reflection,
                wentWell: g.wentWell,
                challenges: g.challenges,
                left: g.left
            }));

            return res.json({ goals: formattedGoals });
        }

        const getCurrentWeek = () => {
            const now = new Date();
            const start = new Date(now.getFullYear(), 0, 1);
            const diff = now.getTime() - start.getTime();
            const weekNum = Math.ceil((diff / 604800000) + 1);
            return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
        };

        if (action === 'add') {
            const currentWeek = data.week || getCurrentWeek();
            const goalData = [
                email,
                'Weekly',
                data.weeklyGoal,
                currentWeek,
                data.status || 'Pending',
                data.reflection || '',
                data.wentWell || '',
                data.challenges || '',
                data.left || ''
            ];
            await appendGoalToSheet(goalData);

            return res.json({ success: true, goal: { email, weeklyGoal: data.weeklyGoal, week: currentWeek, status: data.status || 'Pending' } });
        }

        if (action === 'update') {
            const rowIndex = data.rowIndex;
            if (!rowIndex) return res.status(400).json({ error: "Missing rowIndex for update" });

            const goalData = [
                email,
                'Weekly',
                data.weeklyGoal,
                data.week,
                data.status || 'Pending',
                data.reflection || '',
                data.wentWell || '',
                data.challenges || '',
                data.left || ''
            ];
            await updateGoalInSheet(rowIndex, goalData);
            return res.json({ success: true, message: "Weekly goal updated" });
        }

        return res.status(400).json({ error: "Invalid action" });
    } catch (error) {
        console.error("Weekly goals error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

const fetchReportsHandler = async (req, res) => {
    try {
        const { email } = req.body;
        let query = {};
        if (email) query.email = email;

        const reports = await Report.find(query).sort({ createdAt: -1 });
        return res.json({ reports });
    } catch (error) {
        console.error("Fetch reports error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

const generateReportHandler = async (req, res) => {
    try {
        const { email, username } = req.body;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoString = sevenDaysAgo.toISOString().split("T")[0];

        const allGoals = await fetchGoalsFromSheet(email, 'Daily');
        const userGoals = allGoals.filter(g => g.createdAt >= sevenDaysAgoString).map(g => ({
            dailyGoal: g.text,
            status: g.status,
            wentWell: g.wentWell,
            challenges: g.challenges
        }));

        const totalGoals = userGoals.length;
        const completedGoals = userGoals.filter(g => g.status === 'Completed').length;
        const completionPercent = totalGoals > 0 ? Math.round((completedGoals / totalGoals) * 100) : 0;
        const mainChallenges = userGoals.map(g => g.challenges).filter(Boolean).join("; ");

        let aiFeedback = "";

        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
            try {
                const ai = new GoogleGenAI({ apiKey });
                const prompt = `You are an educational coach analyzing a student's weekly goal progress. Here is the data:
Student: ${username}
Total goals this week: ${totalGoals}
Completed goals: ${completedGoals}
Completion rate: ${completionPercent}%
Goals details:
${userGoals.map(g => `- Goal: "${g.dailyGoal}" | Status: ${g.status} | Challenges: "${g.challenges}"`).join("\n")}

Please provide a personalized weekly report with a summary of their progress, what went well, challenges, how to overcome them, and encouraging remarks. Max 300 words.`;

                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                });
                aiFeedback = response.text || "Keep up the good work!";
            } catch (aiError) {
                console.error("Gemini API error:", aiError);
                aiFeedback = `(AI unavailable) You completed ${completedGoals} out of ${totalGoals} goals this week. Keep pushing forward!`;
            }
        } else {
            aiFeedback = `(AI unavailable - Provide GEMINI_API_KEY) You completed ${completedGoals} out of ${totalGoals} goals this week.`;
        }

        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 1);
        const weekNum = Math.ceil(((now.getTime() - start.getTime()) / 604800000) + 1);
        const currentWeek = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

        const report = new Report({
            username,
            email,
            week: currentWeek,
            completionPercent,
            mainChallenges,
            aiFeedback
        });

        await report.save();

        return res.json({
            success: true,
            report
        });

    } catch (error) {
        console.error("Report generation error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

module.exports = {
    dailyGoalsHandler,
    weeklyGoalsHandler,
    fetchReportsHandler,
    generateReportHandler
};
