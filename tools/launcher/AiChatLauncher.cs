using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace AiChatHubLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string electronCmd = Path.Combine(appDir, "node_modules", ".bin", "electron.cmd");

            if (!File.Exists(electronCmd))
            {
                MessageBox.Show(
                    "node_modules was not found. Please run npm install in the project folder first.",
                    "AI Chat Hub",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/d /c \"\"" + electronCmd + "\" .\"",
                WorkingDirectory = appDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            Process.Start(startInfo);
        }
    }
}
