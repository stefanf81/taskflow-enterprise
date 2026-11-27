import java.lang.classfile.*;
import java.lang.classfile.instruction.ReturnInstruction;
import java.lang.constant.*;
import java.net.URI;
import java.nio.file.*;

/**
 * Diagnostic only: rewrites java.util.concurrent.ForkJoinTask$AdaptedRunnableAction so its
 * constructor also calls ForkJoinTask.setNoUserHelp(), i.e. gives the tasks that
 * VirtualThread submits on JDK 26+ (ForkJoinTask.adapt) the NO_USER_HELP status bit that
 * JDK 25's RunnableExecuteAction (an InterruptibleTask) carried.
 * Writes <outdir>/java/util/concurrent/ForkJoinTask$AdaptedRunnableAction.class for
 * --patch-module java.base=<outdir>.
 *
 * usage: java AddNoUserHelp.java <outdir>   (run with the JDK whose java.base is patched)
 */
public class AddNoUserHelp {
    public static void main(String[] a) throws Exception {
        String name = "java/util/concurrent/ForkJoinTask$AdaptedRunnableAction.class";
        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        byte[] in = Files.readAllBytes(jrt.getPath("modules", "java.base", name));
        ClassDesc fjt = ClassDesc.of("java.util.concurrent.ForkJoinTask");
        ClassFile cf = ClassFile.of();
        ClassModel cm = cf.parse(in);
        byte[] out = cf.transformClass(cm, ClassTransform.transformingMethodBodies(
                m -> m.methodName().equalsString("<init>"),
                (cb, e) -> {
                    if (e instanceof ReturnInstruction) {
                        cb.aload(0);
                        cb.invokevirtual(fjt, "setNoUserHelp", MethodTypeDesc.of(ConstantDescs.CD_void));
                    }
                    cb.with(e);
                }));
        Path dst = Path.of(a[0]).resolve(name);
        Files.createDirectories(dst.getParent());
        Files.write(dst, out);
        System.out.println("wrote " + dst + " (" + out.length + " bytes) for java " + System.getProperty("java.version"));
    }
}
