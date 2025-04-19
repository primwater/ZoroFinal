#!/usr/bin/env python
import os
import traceback
from dotenv import load_dotenv
import vertexai
from vertexai.generative_models import (
    GenerativeModel,
    Part,
    Content,
    GenerationConfig
)

# Load environment variables from .env file
load_dotenv()

# Initialize Vertex AI SDK
try:
    project_id = os.getenv("GOOGLE_PROJECT_ID")
    location = os.getenv("GOOGLE_LOCATION")
    if not project_id or not location:
        raise ValueError("GOOGLE_PROJECT_ID and GOOGLE_LOCATION must be set in the .env file")
    vertexai.init(project=project_id, location=location)
    print(f"Vertex AI initialized for project: {project_id} in location: {location}")
except Exception as e:
    print(f"Error initializing Vertex AI: {e}")
    raise

def generate_chat_name(chat_history):
    """
    Generates a short, creative title for the conversation based on the chat history.
    
    Args:
        chat_history (list): List of dictionaries with 'role' and 'text' keys.
        
    Returns:
        str: A title (in title case, between 2-5 words) or a fallback name.
    """
    conversation_text = ""
    for msg in chat_history:
        role = msg.get('role', '')
        text = msg.get('text', '')
        conversation_text += f"{role.capitalize()}: {text}\n"
    
    system_instruction = (
        "You are an AI chat name generator. Your role is to produce a short, creative, and descriptive title "
        "based on the conversation provided. The title must be in title case and contain between 2 to 5 words. "
        "It should uniquely capture the main topic or essence of the conversation. Do not include any extra explanation "
        "or punctuation—output only the title."
    )
    
    system_content = Part.from_text(system_instruction)
    user_prompt = f"Conversation:\n{conversation_text}\n\nGenerate a title for this conversation:"
    
    try:
        # Use the model name from .env or default to "chat-name-model-001"
        model_name = os.getenv("DEFAULT_CHAT_NAME_MODEL", "gemini-2.0-flash-lite-001")
        model = GenerativeModel(model_name, system_instruction=[system_content])
        generation_config = GenerationConfig(
            temperature=0.2,
            top_p=0.8,
            max_output_tokens=20
        )
        content = [Content(role="user", parts=[Part.from_text(user_prompt)])]
        result = model.generate_content(
            contents=content,
            generation_config=generation_config,
            safety_settings=[],
            stream=False
        )
        if result and result.candidates:
            candidate = result.candidates[0]
            chat_name = candidate.content.parts[0].text.strip()
            return chat_name
        else:
            print("No candidates generated for chat name.")
            return "Untitled Chat"
    except Exception as e:
        print(f"Error generating chat name: {e}")
        print(traceback.format_exc())
        # Fallback if the model is not found or any other error occurs
        return "Untitled Chat"

if __name__ == '__main__':
    # Test the function with a simulated conversation.
    test_history = [
        {"role": "user", "text": "What's the weather like today?"},
        {"role": "model", "text": "It looks clear and sunny with a slight breeze."},
        {"role": "user", "text": "Great, I'll plan a picnic then."}
    ]
    name = generate_chat_name(test_history)
    print("Generated chat name:", name)
