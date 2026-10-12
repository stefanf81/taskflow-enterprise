package com.example.taskflow.migration;

/** Runs the data-migration scenarios on H2 in PostgreSQL mode (the engine of dev/test and CI). */
class DataMigrationsH2Test extends AbstractDataMigrationsTest {

    @Override
    protected String newUrl() {
        return "jdbc:h2:mem:datamig-" + System.nanoTime() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
    }

    @Override
    protected String user() {
        return "sa";
    }

    @Override
    protected String password() {
        return "";
    }

    @Override
    protected boolean isPostgres() {
        return false;
    }

    @Override
    protected String indexNamesSql() {
        return "SELECT LOWER(INDEX_NAME) FROM INFORMATION_SCHEMA.INDEXES";
    }
}
