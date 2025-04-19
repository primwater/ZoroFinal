import os
import json  # Import json for SSE data formatting
import traceback  # For detailed error logging
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from dotenv import load_dotenv
from chatbot import get_gemini_response_stream, Content, Part  # Import necessary items

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Default settings (cannot be changed by the user)
DEFAULT_MODEL = os.getenv("DEFAULT_GEMINI_MODEL", "gemini-2.0-flash-001")
DEFAULT_SYSTEM_INSTRUCTION = ""

@app.route('/')
def index():
    """Renders the main chat page."""
    return render_template('index.html',
                           default_model=DEFAULT_MODEL,
                           default_system_instruction=DEFAULT_SYSTEM_INSTRUCTION)

@app.route('/chat', methods=['POST'])
def chat():
    """Handles the chat request and streams the response."""
    if not request.is_json:
        print("Error: Request content type is not application/json")
        return jsonify({"error": "Request must be JSON"}), 415

    try:
        data = request.get_json()
        if not data:  # Handle empty JSON body
            print("Error: Empty JSON body received")
            return jsonify({"error": "Request body cannot be empty"}), 400

        user_prompt = data.get('prompt')
        history = data.get('history', [])  # Expected format: [{role: 'user'/'model', text: '...'}, ...]
        
        # Extract custom instructions entered by the user and trim whitespace.
        custom_instructions = data.get('system_instruction', '').strip()
        # Combine custom instructions with the base (immutable) instructions from .env.
        if custom_instructions:
            system_instruction = f"User instructions: {custom_instructions}\n\nSystem instructions: {DEFAULT_SYSTEM_INSTRUCTION}"
        else:
            system_instruction = DEFAULT_SYSTEM_INSTRUCTION

        model_name = data.get('model', DEFAULT_MODEL)

        # --- Input Validation ---
        if not user_prompt or not isinstance(user_prompt, str):
            print(f"Error: Invalid prompt received: {user_prompt}")
            return jsonify({"error": "Valid 'prompt' (string) is required"}), 400
        if not isinstance(history, list):
            print(f"Error: Invalid history format received: {history}")
            return jsonify({"error": "'history' must be a list"}), 400

        # Convert history from the simple client format to Content objects.
        chat_history = []
        for i, msg in enumerate(history):
            if not isinstance(msg, dict):
                print(f"Warning: Invalid item type in history (index {i}), expected dict: {msg}")
                continue  # Skip invalid items
            role = msg.get('role')
            text = msg.get('text')
            if role in ['user', 'model'] and isinstance(text, str):
                chat_history.append(Content(role=role.lower(), parts=[Part.from_text(text)]))
            else:
                print(f"Warning: Invalid message format in history ignored (index {i}): {msg}")

        # Debug output
        print("\n--- Received Request ---")
        print(f"Model: {model_name}")
        print(f"System Instruction: {'Provided' if system_instruction else 'Empty/Default'}")
        print(f"History Length Sent (items): {len(history)}")
        print("----------------------\n")

        @stream_with_context
        def generate_response_stream():
            try:
                stream = get_gemini_response_stream(
                    model_name=model_name,
                    user_prompt=user_prompt,
                    system_instruction=system_instruction,
                    chat_history=chat_history
                )
                for chunk in stream:
                    yield f"data: {json.dumps(chunk)}\n\n"
            except Exception as e:
                print(f"Error during streaming generation in Flask: {e}\n{traceback.format_exc()}")
                error_message = f"Stream Error: {str(e)}"
                yield f"event: error\ndata: {json.dumps({'error': error_message})}\n\n"

        return Response(generate_response_stream(), mimetype='text/event-stream')

    except json.JSONDecodeError as json_err:
        print(f"Error decoding JSON request body: {json_err}")
        return jsonify({"error": f"Invalid JSON format: {json_err}"}), 400
    except Exception as e:
        print(f"Error in /chat endpoint before streaming: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An internal server error occurred: {str(e)}"}), 500

@app.route('/name_chat', methods=['POST'])
def name_chat():
    """
    Receives a JSON payload with the chat history and returns an AI-generated chat title.
    Expects: { "chat_history": [ {"role": "user"/"model", "text": "..."}, ... ] }
    """
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 415
    try:
        data = request.get_json()
        chat_history = data.get('chat_history', [])
        # Import the chat naming function from name_chat.py (ensure that file is in your project)
        from name_chat import generate_chat_name
        chat_title = generate_chat_name(chat_history)
        return jsonify({"chat_title": chat_title}), 200
    except Exception as e:
        print(f"Error in /name_chat endpoint: {e}\n{traceback.format_exc()}")
        return jsonify({"chat_title": "Untitled Chat", "error": str(e)}), 500

if __name__ == '__main__':
    print(f"Starting Flask server on http://0.0.0.0:5000 with debug={'True' if os.environ.get('FLASK_DEBUG') else 'False'}")
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)
