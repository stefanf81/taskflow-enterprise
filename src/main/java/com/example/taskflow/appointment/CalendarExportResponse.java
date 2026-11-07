package com.example.taskflow.appointment;

/** JSON transport works with browser downloads and native file-sharing APIs alike. */
public record CalendarExportResponse(String content, String filename) {}
