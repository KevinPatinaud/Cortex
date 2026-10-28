using System;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Cortex")]
[assembly: AssemblyDescription("Lanceur local de Cortex")]
[assembly: AssemblyProduct("Cortex")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class CortexLauncher
{
    private const string BaseUrl = "http://127.0.0.1:3000";
    private const string InterfaceUrl = BaseUrl + "/?mode=prompts";
    private static readonly object LogLock = new object();
    private static StreamWriter log;

    [STAThread]
    private static int Main()
    {
        bool acquired = false;
        bool ready = false;
        Process server = null;
        string logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cortex", "launcher.log");
        using (Mutex startup = new Mutex(false, "Local\\Cortex.Local.Startup"))
        {
            try
            {
                try { acquired = startup.WaitOne(TimeSpan.FromSeconds(90)); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new Exception("Un démarrage de Cortex est déjà en cours. Réessayez dans quelques instants.");

                if (IsReady())
                {
                    OpenInterface();
                    return 0;
                }
                if (PortIsOccupied()) throw new Exception("Le port local 3000 est utilisé par une autre application. Cortex n’a pas été redémarré.");

                string directory = RequiredSetting("WorkingDirectory");
                string node = RequiredSetting("NodeExecutable");
                string npm = RequiredSetting("NpmCli");
                if (!File.Exists(Path.Combine(directory, "src", "back", "infrastructure", "web", "controller", "server.ts")))
                    throw new Exception("Le dossier de Cortex est introuvable : " + directory);
                if (!File.Exists(node) || !File.Exists(npm)) throw new Exception("Node.js ou npm est introuvable. Réinstallez le raccourci Cortex.");

                Directory.CreateDirectory(Path.GetDirectoryName(logPath));
                log = new StreamWriter(logPath, true, new UTF8Encoding(false));
                log.AutoFlush = true;
                WriteLog("Démarrage de Cortex dans " + directory);

                // A cold start rebuilds the interface, as npm start does. No console is shown.
                using (Process build = StartLogged(node, Quote(npm) + " run build", directory))
                {
                    if (!build.WaitForExit(120000))
                    {
                        build.Kill();
                        throw new Exception("La préparation de Cortex prend trop de temps. Consultez " + logPath);
                    }
                    build.WaitForExit();
                    if (build.ExitCode != 0) throw new Exception("La préparation de Cortex a échoué. Consultez " + logPath);
                }

                server = StartLogged(node, "--import tsx src/back/infrastructure/web/controller/server.ts", directory);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (DateTime.UtcNow < deadline)
                {
                    if (server.HasExited) throw new Exception("Le serveur Cortex s’est arrêté au démarrage. Consultez " + logPath);
                    if (IsReady()) { ready = true; break; }
                    Thread.Sleep(300);
                }
                if (!ready) throw new Exception("Le serveur Cortex ne répond pas. Consultez " + logPath);
                WriteLog("Cortex disponible : " + InterfaceUrl);
                OpenInterface();
                return 0;
            }
            catch (Exception error)
            {
                WriteLog(error.Message);
                MessageBox.Show(error.Message, "Cortex", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (acquired) startup.ReleaseMutex();
                // Keep redirected output alive for the server's lifetime. Subsequent
                // shortcut clicks release the startup mutex and reuse this same server.
                if (server != null)
                {
                    if (!ready && !server.HasExited) server.Kill();
                    server.WaitForExit();
                    server.Dispose();
                }
                if (log != null) log.Dispose();
            }
        }
    }

    private static string RequiredSetting(string name)
    {
        string value = ConfigurationManager.AppSettings[name];
        if (String.IsNullOrWhiteSpace(value)) throw new Exception("Configuration du lanceur manquante : " + name);
        return value;
    }

    private static Process StartLogged(string file, string arguments, string directory)
    {
        Process process = new Process();
        process.StartInfo = new ProcessStartInfo(file, arguments)
        {
            WorkingDirectory = directory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        process.StartInfo.EnvironmentVariables["PORT"] = "3000";
        process.StartInfo.EnvironmentVariables["HOST"] = "127.0.0.1";
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { WriteLog(eventArgs.Data); };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs) { WriteLog(eventArgs.Data); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }

    private static bool IsReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/health");
            request.Proxy = null;
            request.Timeout = 1500;
            request.ReadWriteTimeout = 1500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                string body = reader.ReadToEnd().Replace(" ", "");
                return response.StatusCode == HttpStatusCode.OK && body.Contains("\"status\":\"ok\"");
            }
        }
        catch (WebException) { return false; }
    }

    private static bool PortIsOccupied()
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult connection = client.BeginConnect("127.0.0.1", 3000, null, null);
                if (!connection.AsyncWaitHandle.WaitOne(500)) return false;
                client.EndConnect(connection);
                return true;
            }
        }
        catch (SocketException) { return false; }
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    private static void OpenInterface() { Process.Start(new ProcessStartInfo(InterfaceUrl) { UseShellExecute = true }); }
    private static void WriteLog(string message)
    {
        if (String.IsNullOrEmpty(message)) return;
        lock (LogLock) { if (log != null) log.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message); }
    }
}
