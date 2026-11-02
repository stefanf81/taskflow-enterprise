package db.migration;

import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;

import static org.mockito.Mockito.*;

class V37EnablePgStatStatementsTest {

    @Test
    void skipsH2WithoutExecutingPostgresSql() throws Exception {
        Connection connection = connection("H2");
        migrate(connection);
        verify(connection, never()).createStatement();
        verify(connection, never()).setSavepoint();
    }

    @Test
    void installsExtensionIdempotentlyInPublicSchema() throws Exception {
        Connection connection = connection("PostgreSQL");
        Statement statement = mock(Statement.class);
        Savepoint savepoint = mock(Savepoint.class);
        when(connection.setSavepoint()).thenReturn(savepoint);
        when(connection.createStatement()).thenReturn(statement);

        migrate(connection);

        verify(statement).execute("CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public");
        verify(statement).close();
        verify(connection, never()).rollback(any(Savepoint.class));
        verify(connection).releaseSavepoint(savepoint);
    }

    @Test
    void restoresTransactionWhenInstallationIsNotPermitted() throws Exception {
        Connection connection = connection("PostgreSQL");
        Statement statement = mock(Statement.class);
        Savepoint savepoint = mock(Savepoint.class);
        when(connection.setSavepoint()).thenReturn(savepoint);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.execute(anyString())).thenThrow(new SQLException("permission denied", "42501"));

        migrate(connection);

        verify(connection).rollback(savepoint);
        verify(connection).releaseSavepoint(savepoint);
    }

    private static Connection connection(String product) throws SQLException {
        Connection connection = mock(Connection.class);
        DatabaseMetaData metadata = mock(DatabaseMetaData.class);
        when(connection.getMetaData()).thenReturn(metadata);
        when(metadata.getDatabaseProductName()).thenReturn(product);
        return connection;
    }

    private static void migrate(Connection connection) throws Exception {
        Context context = mock(Context.class);
        when(context.getConnection()).thenReturn(connection);
        new V37__enable_pg_stat_statements().migrate(context);
    }
}
