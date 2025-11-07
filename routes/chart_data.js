const express = require("express");
const router = express.Router();
const db = require("../config/db_conn");

// GET /api/chart-data
router.get("/", async (req, res) => {
  try {
    const queries = {
      college_acad_year: "SELECT COUNT(id) AS count FROM public.college_acad_year",
      college_attendance: "SELECT COUNT(attid) AS count FROM public.college_attendance",
      college_classroom: "SELECT COUNT(classroomid) AS count FROM public.college_classroom",
      college_course_offering: "SELECT COUNT(offerid) AS count FROM public.college_course_offering",
      college_course_regis: "SELECT COUNT(course_regis_id) AS count FROM public.college_course_regis",
      college_daily_routine: "SELECT COUNT(routineid) AS count FROM public.college_daily_routine",
      college_depts: "SELECT COUNT(collegedeptid) AS count FROM public.college_depts",
      college_exam_result: "SELECT COUNT(examresultid) AS count FROM public.college_exam_result",
      college_exam_routine: "SELECT COUNT(examid) AS count FROM public.college_exam_routine",
      employee_attendance: "SELECT COUNT(attid) AS count FROM public.employee_attendance",
      master_college: "SELECT COUNT(collegeid) AS count FROM public.master_college",
      master_college_group: "SELECT COUNT(groupid) AS count FROM public.master_college_group",
      master_course: "SELECT COUNT(courseid) AS count FROM public.master_course",
      master_role: "SELECT COUNT(role_id) AS count FROM public.master_role",
      master_subject: "SELECT COUNT(subjectid) AS count FROM public.master_subject",
      master_teacher: "SELECT COUNT(teacherid) AS count FROM public.master_teacher",
      master_user: "SELECT COUNT(userid) AS count FROM public.master_user",
      menu_master: "SELECT COUNT(menuid) AS count FROM public.menu_master",
      student_master: "SELECT COUNT(stuid) AS count FROM public.student_master",
      subject_course: "SELECT COUNT(sub_cou_id) AS count FROM public.subject_course",
      subject_elec: "SELECT COUNT(sub_elec_id) AS count FROM public.subject_elec",
      subject_teacher: "SELECT COUNT(subteaid) AS count FROM public.subject_teacher",
      teacher_availbility: "SELECT COUNT(teaacheravlid) AS count FROM public.teacher_availbility",
      user_role: "SELECT COUNT(userid) AS count FROM public.user_role"
    };

    const result = {};
    for (const [key, sql] of Object.entries(queries)) {
      const { rows } = await db.query(sql);
      result[key] = parseInt(rows[0].count, 10);
    }

    res.json({
      status: "success",
      timestamp: new Date().toISOString(),
      data: result
    });
  } catch (err) {
    console.error("Error fetching chart data:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

module.exports = router;