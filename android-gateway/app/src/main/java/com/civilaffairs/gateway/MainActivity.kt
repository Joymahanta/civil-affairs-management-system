package com.civilaffairs.gateway

import android.Manifest
import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telephony.SmsManager
import android.content.pm.PackageManager
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var statusText: TextView
    private var running = false

    private val poller = object : Runnable {
        override fun run() {
            if (!running) return
            executor.execute { pollJobs() }
            handler.postDelayed(this, 15_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.SEND_SMS), 100)
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        val title = TextView(this).apply {
            text = "Civil Affairs SMS Gateway"
            textSize = 24f
            setTextColor(Color.BLACK)
            setPadding(0, 0, 0, 20)
        }
        serverInput = EditText(this).apply {
            hint = "Server URL"
            setSingleLine(true)
            setText(getPreferences(0).getString("server", "https://civil-affairs-management-system.onrender.com"))
        }
        tokenInput = EditText(this).apply {
            hint = "Gateway token"
            setSingleLine(true)
            setInputType(0x00000081)
            setText(getPreferences(0).getString("token", ""))
        }
        val start = Button(this).apply { text = "Start SMS Gateway" }
        val stop = Button(this).apply { text = "Stop"; isEnabled = false }
        statusText = TextView(this).apply {
            text = "Gateway stopped"
            textSize = 16f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 24, 0, 0)
        }
        start.setOnClickListener {
            saveSettings()
            running = true
            start.isEnabled = false
            stop.isEnabled = true
            statusText.text = "Gateway running — checking for SMS jobs every 15 seconds"
            handler.removeCallbacks(poller)
            handler.post(poller)
        }
        stop.setOnClickListener {
            running = false
            handler.removeCallbacks(poller)
            start.isEnabled = true
            stop.isEnabled = false
            statusText.text = "Gateway stopped"
        }
        root.addView(title)
        root.addView(serverInput)
        root.addView(tokenInput)
        root.addView(start)
        root.addView(stop)
        root.addView(statusText)
        setContentView(root)
    }

    private fun saveSettings() {
        getPreferences(0).edit()
            .putString("server", serverInput.text.toString().trim().trimEnd('/'))
            .putString("token", tokenInput.text.toString().trim())
            .apply()
    }

    private fun pollJobs() {
        val server = serverInput.text.toString().trim().trimEnd('/')
        val token = tokenInput.text.toString().trim()
        if (server.isBlank() || token.isBlank()) {
            updateStatus("Enter the server URL and gateway token")
            return
        }
        try {
            val response = request("GET", "$server/api/sms/gateway/jobs?limit=5", token, null)
            val jobs = JSONObject(response).optJSONArray("jobs") ?: return
            for (i in 0 until jobs.length()) {
                val job = jobs.getJSONObject(i)
                sendJob(server, token, job)
            }
        } catch (e: Exception) {
            updateStatus("Gateway connection error: ${e.message ?: "unknown error"}")
        }
    }

    private fun sendJob(server: String, token: String, job: JSONObject) {
        val id = job.getLong("id")
        val recipient = job.getString("recipient")
        val message = job.getString("message")
        var success = false
        var error = ""
        try {
            if (checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("SMS permission has not been granted")
            }
            SmsManager.getDefault().sendTextMessage(recipient, null, message, null, null)
            success = true
            updateStatus("SMS sent to $recipient")
        } catch (e: Exception) {
            error = e.message ?: "SMS send failed"
            updateStatus("SMS failed: $error")
        }
        val payload = JSONObject().apply {
            put("id", id)
            put("success", success)
            if (error.isNotBlank()) put("error", error)
            put("messageId", "android-$id")
        }
        try {
            request("POST", "$server/api/sms/gateway/result", token, payload.toString())
        } catch (e: Exception) {
            updateStatus("SMS sent, but result could not be recorded")
        }
    }

    private fun request(method: String, urlText: String, token: String, body: String?): String {
        val connection = URL(urlText).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 10_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("x-gateway-token", token)
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doInput = true
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        connection.disconnect()
        if (code !in 200..299) throw IllegalStateException("HTTP $code: $text")
        return text
    }

    private fun updateStatus(message: String) {
        runOnUiThread { statusText.text = message }
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacks(poller)
        executor.shutdownNow()
        super.onDestroy()
    }
}
